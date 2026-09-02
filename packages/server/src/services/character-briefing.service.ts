import type { CharacterBriefingInstructionSlot, CharacterBriefingState } from "@marinara-engine/shared";
import { BUILT_IN_TOOLS, parseCharacterBriefingTemplate, reconstructCharacterBriefing } from "@marinara-engine/shared";
import type { DB } from "../db/connection.js";
import { createCharactersStorage } from "./storage/characters.storage.js";
import { createLorebooksStorage } from "./storage/lorebooks.storage.js";
import { createCharacterBriefingsStorage } from "./storage/character-briefings.storage.js";
import { createCharacterDailyMemoriesStorage } from "./storage/character-daily-memories.storage.js";
import { createCharacterDailyMemoryRetrievalService } from "./character-daily-memories/retrieval.service.js";
import { resolveFormationConnection } from "./character-daily-memories/formation.service.js";
import { executeToolCallForModel } from "./tools/tool-executor.js";
import type { ChatMessage, LLMToolDefinition } from "./llm/base-provider.js";

type CharacterBriefingDependencies = { db: DB };
type Entity = { type: "character" | "lorebook"; id: string; label: string; data: unknown };

const TOOL_NAME = "search_character_daily_memories";
const briefingTool: LLMToolDefinition = {
  type: "function",
  function: {
    name: TOOL_NAME,
    description: BUILT_IN_TOOLS.find((tool) => tool.name === TOOL_NAME)?.description ?? "Search Daily Memories",
    parameters: BUILT_IN_TOOLS.find((tool) => tool.name === TOOL_NAME)?.parameters as unknown as Record<
      string,
      unknown
    >,
  },
};

function parseCard(data: unknown): Record<string, unknown> {
  if (typeof data !== "string") return (data && typeof data === "object" ? data : {}) as Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(data);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function parseTerminal(content: string): string {
  const trimmed = content
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/u, "");
  try {
    const value: unknown = JSON.parse(trimmed);
    if (value && typeof value === "object" && typeof (value as { replacement?: unknown }).replacement === "string") {
      const replacement = (value as { replacement: string }).replacement.trim();
      if (replacement) return replacement;
    }
  } catch {
    // A non-JSON terminal response is invalid by the slot contract.
  }
  throw new Error("Character Briefing agent returned an invalid replacement");
}

function entityContext(entity: Entity): string {
  return `${entity.type === "character" ? "Referenced Character Card" : "Referenced Lorebook"} (${entity.label}, ID: ${entity.id}):\n${JSON.stringify(entity.data)}`;
}

export function createCharacterBriefingService({ db }: CharacterBriefingDependencies) {
  const storage = createCharacterBriefingsStorage(db);
  const chars = createCharactersStorage(db);
  const lorebooks = createLorebooksStorage(db);
  const memories = createCharacterDailyMemoriesStorage(db);
  const retrieval = createCharacterDailyMemoryRetrievalService({ db, storage: memories });
  const inFlight = new Set<string>();

  async function resolveReferences(slots: CharacterBriefingInstructionSlot[]): Promise<Map<string, Entity>> {
    const references = slots.flatMap((slot) => slot.references);
    const resolved = new Map<string, Entity>();
    for (const reference of references) {
      const key = `${reference.type}:${reference.id}`;
      if (resolved.has(key)) continue;
      const row =
        reference.type === "character" ? await chars.getById(reference.id) : await lorebooks.getById(reference.id);
      if (!row) throw new Error(`Referenced ${reference.type} was not found: ${reference.id}`);
      resolved.set(key, {
        type: reference.type,
        id: reference.id,
        label: reference.label,
        data: reference.type === "character" ? parseCard((row as { data: unknown }).data) : row,
      });
    }
    return resolved;
  }

  async function executeSlot(
    characterId: string,
    slot: CharacterBriefingInstructionSlot,
    sourceTemplate: string,
    ownerCard: Record<string, unknown>,
    entities: Map<string, Entity>,
    connection: Awaited<ReturnType<typeof resolveFormationConnection>>,
  ): Promise<string> {
    if (!connection) throw new Error("No usable Character Briefing generation connection is configured");
    const currentEntities = slot.references
      .map((reference) => entities.get(`${reference.type}:${reference.id}`))
      .filter(Boolean) as Entity[];
    const messages: ChatMessage[] = [
      {
        role: "system",
        content:
          'You are the Character Briefing agent. Return JSON only in the form {"replacement":"..."}. The replacement must contain briefing content for the current instruction only, with no wrapper, explanation, heading, or instruction text. Do not rewrite the source template.',
      },
      {
        role: "user",
        content: [
          `Owning Character Card (ID: ${characterId}) [read-only]:\n${JSON.stringify(ownerCard)}`,
          "Persona context: absent by design.",
          `Complete Source Template snapshot [read-only]:\n${sourceTemplate}`,
          `Current instruction [read-only]:\n${slot.instruction}`,
          ...currentEntities.map(entityContext),
          `Current date/time: ${new Date().toISOString()}`,
          "Use the Daily Memory tool only when relevant. Natural-language names are not entity references.",
        ].join("\n\n"),
      },
    ];
    for (let round = 0; round < 4; round += 1) {
      const result = await connection.provider.chatComplete(messages, {
        model: connection.model,
        stream: false,
        tools: round < 3 ? [briefingTool] : undefined,
        responseFormat: round < 3 ? undefined : { type: "json_object" },
      });
      if (result.toolCalls?.length) {
        messages.push({ role: "assistant", content: result.content ?? "", tool_calls: result.toolCalls });
        for (const call of result.toolCalls) {
          if (call.function.name !== TOOL_NAME)
            throw new Error(`Unsupported Character Briefing tool: ${call.function.name}`);
          const toolResult = await executeToolCallForModel(call, {
            searchCharacterDailyMemories: (query) => retrieval.searchForCharacter({ characterId, query }),
          });
          messages.push({ role: "tool", content: toolResult, tool_call_id: call.id });
        }
        continue;
      }
      return parseTerminal(result.content ?? "");
    }
    throw new Error("Character Briefing agent exhausted its tool rounds");
  }

  return {
    storage,
    async generate(characterId: string): Promise<CharacterBriefingState> {
      if (inFlight.has(characterId)) throw new Error("Character Briefing generation is already in progress");
      inFlight.add(characterId);
      try {
        const character = await chars.getById(characterId);
        if (!character) throw new Error("Character not found");
        const state = await storage.get(characterId);
        const sourceTemplate = state.sourceTemplate;
        const slots = parseCharacterBriefingTemplate(sourceTemplate);
        if (slots.length === 0) return storage.publishLatest(characterId, sourceTemplate, sourceTemplate);
        const entities = await resolveReferences(slots);
        const connection = await resolveFormationConnection(db, state.generationConnectionId);
        const replacements: string[] = [];
        for (const slot of slots)
          replacements.push(
            await executeSlot(characterId, slot, sourceTemplate, parseCard(character.data), entities, connection),
          );
        return storage.publishLatest(
          characterId,
          sourceTemplate,
          reconstructCharacterBriefing(sourceTemplate, slots, replacements),
        );
      } finally {
        inFlight.delete(characterId);
      }
    },
  };
}

export type CharacterBriefingService = ReturnType<typeof createCharacterBriefingService>;
