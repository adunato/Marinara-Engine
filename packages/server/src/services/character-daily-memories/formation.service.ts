import { LOCAL_SIDECAR_CONNECTION_ID, parseCharacterDailyMemoryFormationOutput } from "@marinara-engine/shared";
import type { CharacterDailyMemoryWindow, CharacterDailyMemoryRunSource } from "@marinara-engine/shared";
import { and, asc, eq } from "../../db/file-query.js";
import type { DB } from "../../db/connection.js";
import { characters, chats, messages, personas } from "../../db/schema/index.js";
import { now } from "../../utils/id-generator.js";
import { getLocalSidecarProvider, LOCAL_SIDECAR_MODEL } from "../llm/local-sidecar.js";
import { createLLMProvider } from "../llm/provider-registry.js";
import { withConnectionFallbackProvider } from "../llm/connection-fallback-provider.js";
import { resolveBaseUrl } from "../generation/connection-base-url.js";
import { createConnectionsStorage } from "../storage/connections.storage.js";
import {
  createCharacterDailyMemoriesStorage,
  type CharacterDailyMemoriesStorage,
} from "../storage/character-daily-memories.storage.js";
import { embedCharacterDailyMemoryText } from "./embedding.service.js";

type FormationConnection = {
  provider: import("../llm/base-provider.js").BaseLLMProvider;
  model: string;
  connectionId: string;
};
type SourceMessage = {
  role: "user" | "assistant" | "narrator";
  characterId: string | null;
  content: string;
  createdAt: string;
};
type FormationSource = { id: string; name: string; firstEligibleMessageAt: string; messages: SourceMessage[] };

function parseJsonObject(value: unknown): Record<string, unknown> {
  if (typeof value !== "string") return {};
  const stripped = value
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/u, "");
  try {
    const parsed: unknown = JSON.parse(stripped);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
  } catch {
    const start = stripped.indexOf("{");
    const end = stripped.lastIndexOf("}");
    if (start < 0 || end <= start) return {};
    try {
      const parsed: unknown = JSON.parse(stripped.slice(start, end + 1));
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
    } catch {
      return {};
    }
  }
}

function parseJsonRecord(value: unknown): Record<string, unknown> {
  if (!value) return {};
  if (typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  return parseJsonObject(value);
}

function containsCharacter(value: unknown, characterId: string): boolean {
  const parsed = Array.isArray(value)
    ? value
    : (() => {
        try {
          return JSON.parse(String(value ?? "[]"));
        } catch {
          return [];
        }
      })();
  return Array.isArray(parsed) && parsed.includes(characterId);
}

function isVisibleMessage(message: { role: string; content: string; extra: unknown }, characterId: string): boolean {
  if (!["user", "assistant", "narrator"].includes(message.role) || !message.content.trim()) return false;
  const extra = parseJsonRecord(message.extra);
  if (extra.hiddenFromAI === true) return false;
  const hiddenFor = extra.hiddenFromAICharacterIds;
  return !(Array.isArray(hiddenFor) && hiddenFor.includes(characterId));
}

export async function discoverCharacterDailyMemorySources(
  db: DB,
  characterId: string,
  window: CharacterDailyMemoryWindow,
): Promise<FormationSource[]> {
  const candidateChats = await db
    .select()
    .from(chats)
    .where(eq(chats.mode, "conversation"))
    .orderBy(asc(chats.createdAt), asc(chats.id));
  const sources: FormationSource[] = [];
  for (const chat of candidateChats) {
    if (!containsCharacter(chat.characterIds, characterId)) continue;
    const chatMessages = await db
      .select()
      .from(messages)
      .where(and(eq(messages.chatId, chat.id)))
      .orderBy(asc(messages.createdAt), asc(messages.id));
    const eligible = chatMessages
      .filter((message) => message.createdAt >= window.windowStartAt && message.createdAt < window.windowEndAt)
      .filter((message) => isVisibleMessage(message, characterId))
      .map((message) => ({
        role: message.role as SourceMessage["role"],
        characterId: message.characterId ?? null,
        content: message.content.trim(),
        createdAt: message.createdAt,
      }));
    if (!eligible.length) continue;
    sources.push({ id: chat.id, name: chat.name, firstEligibleMessageAt: eligible[0]!.createdAt, messages: eligible });
  }
  return sources.sort(
    (a, b) => a.firstEligibleMessageAt.localeCompare(b.firstEligibleMessageAt) || a.id.localeCompare(b.id),
  );
}

function characterName(row: { data: string } | undefined, fallback: string): string {
  if (!row) return fallback;
  const data = parseJsonRecord(row.data);
  return typeof data.name === "string" && data.name.trim() ? data.name.trim() : fallback;
}

export async function buildCharacterDailyMemoryTranscript(args: {
  db: DB;
  characterId: string;
  source: FormationSource;
}): Promise<string> {
  const chatRows = await args.db
    .select({ personaId: chats.personaId, characterIds: chats.characterIds })
    .from(chats)
    .where(eq(chats.id, args.source.id));
  let sourceCharacterIds: string[] = [];
  try {
    const parsed: unknown = JSON.parse(String(chatRows[0]?.characterIds ?? "[]"));
    sourceCharacterIds = Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === "string") : [];
  } catch {
    sourceCharacterIds = [];
  }
  const characterRows = await args.db.select({ id: characters.id, data: characters.data }).from(characters);
  const characterNames = new Map<string, string>();
  for (const row of characterRows) {
    if (sourceCharacterIds.includes(row.id)) characterNames.set(row.id, characterName(row, "Character"));
  }
  characterNames.set(
    args.characterId,
    characterName(
      characterRows.find((row) => row.id === args.characterId),
      "Character",
    ),
  );
  const personaId = chatRows[0]?.personaId;
  const personaRows = personaId
    ? await args.db.select({ name: personas.name }).from(personas).where(eq(personas.id, personaId))
    : [];
  const userName = personaRows[0]?.name?.trim() || "User";
  return args.source.messages
    .map((message) => {
      const speaker =
        message.role === "user"
          ? userName
          : message.role === "narrator"
            ? "Narrator"
            : (characterNames.get(message.characterId ?? "") ?? "Character");
      return `[${message.createdAt}] ${speaker}: ${message.content}`;
    })
    .join("\n");
}

async function resolveFormationConnection(db: DB, requestedId?: string | null): Promise<FormationConnection | null> {
  const connections = createConnectionsStorage(db);
  const configured = requestedId?.trim() ? await connections.getWithKey(requestedId.trim()) : null;
  const primary = configured ?? (await connections.getDefaultForAgents());
  const fallback = await connections.getFallbackForAgents();
  if (!primary) return null;
  if (primary.id === LOCAL_SIDECAR_CONNECTION_ID)
    return {
      provider: withConnectionFallbackProvider({
        primary: getLocalSidecarProvider(),
        primaryConnectionId: primary.id,
        fallbackConnection: fallback,
        fallbackBaseUrl: fallback ? resolveBaseUrl(fallback) : "",
        category: "agents",
      }),
      model: LOCAL_SIDECAR_MODEL,
      connectionId: primary.id,
    };
  const baseUrl = resolveBaseUrl(primary);
  if (!baseUrl || primary.provider === "image_generation" || primary.provider === "video_generation") return null;
  const provider = createLLMProvider(
    primary.provider,
    baseUrl,
    primary.apiKey,
    primary.maxContext,
    primary.openrouterProvider,
    primary.maxTokensOverride,
    primary.claudeFastMode === "true",
    primary.treatAsLocalEndpoint === "true",
    primary.defaultParameters,
    primary.id,
  );
  return {
    provider: withConnectionFallbackProvider({
      primary: provider,
      primaryConnectionId: primary.id,
      fallbackConnection: fallback,
      fallbackBaseUrl: fallback ? resolveBaseUrl(fallback) : "",
      category: "agents",
    }),
    model: primary.model,
    connectionId: primary.id,
  };
}

export type CharacterDailyMemoryFormationService = ReturnType<typeof createCharacterDailyMemoryFormationService>;

export function createCharacterDailyMemoryFormationService(args: { db: DB; storage?: CharacterDailyMemoriesStorage }) {
  const storage = args.storage ?? createCharacterDailyMemoriesStorage(args.db);

  async function processSource(
    characterId: string,
    runId: string,
    source: CharacterDailyMemoryRunSource,
    targetName: string,
    formation: FormationConnection,
    prompt: string,
    window: CharacterDailyMemoryWindow,
  ) {
    const sourceData = (await discoverCharacterDailyMemorySources(args.db, characterId, window)).find(
      (item) => item.id === source.sourceConversationId,
    );
    if (!sourceData) {
      await storage.updateRunSource(
        source.id,
        { status: "empty", attempts: source.attempts + 1, lastError: null, nextRetryAt: null },
        characterId,
      );
      return "empty" as const;
    }
    const transcript = await buildCharacterDailyMemoryTranscript({ db: args.db, characterId, source: sourceData });
    await storage.updateRunSource(
      source.id,
      { status: "running", attempts: source.attempts + 1, lastError: null, nextRetryAt: null },
      characterId,
    );
    try {
      const result = await formation.provider.chatComplete(
        [
          {
            role: "system",
            content: `${prompt}\n\nTarget character: ${targetName} (ID: ${characterId}). Return JSON only in the shape {"memories":[{"text":"...","importance":1}]}.`,
          },
          { role: "user", content: transcript },
        ],
        { model: formation.model, responseFormat: { type: "json_object" }, temperature: 0.2, stream: false },
      );
      const output = parseCharacterDailyMemoryFormationOutput(parseJsonObject(result.content));
      for (const memory of output.memories) {
        const embedding = await embedCharacterDailyMemoryText(args.db, memory.text, formation.connectionId);
        await storage.createMemory(
          {
            characterId,
            dayId: (await storage.getRun(runId, characterId))!.dayId,
            runId,
            runSourceId: source.id,
            origin: "formed",
            sourceConversationId: source.sourceConversationId,
            sourceConversationName: source.sourceConversationName,
            text: memory.text,
            importance: memory.importance,
            embedding: embedding?.embedding ?? null,
            embeddingSpaceId: embedding?.embeddingSpaceId ?? null,
          },
          characterId,
        );
      }
      await storage.updateRunSource(
        source.id,
        { status: output.memories.length ? "success" : "empty", lastError: null, nextRetryAt: null },
        characterId,
      );
      return output.memories.length ? ("success" as const) : ("empty" as const);
    } catch (error) {
      await storage.updateRunSource(
        source.id,
        {
          status: "failed",
          lastError: error instanceof Error ? error.message : "Formation failed",
          nextRetryAt: new Date(Date.now() + 60_000).toISOString(),
        },
        characterId,
      );
      return "failed" as const;
    }
  }

  return {
    storage,
    discoverSources: (characterId: string, window: CharacterDailyMemoryWindow) =>
      discoverCharacterDailyMemorySources(args.db, characterId, window),
    async ensureCharacterMemoryDay(
      characterId: string,
      window: CharacterDailyMemoryWindow,
      trigger: "scheduled" | "startup" | "manual-generate" = "scheduled",
    ) {
      let day = await storage.getDayByWindow(characterId, window.windowEndAt);
      if (day?.status === "deleted" && trigger !== "manual-generate") return day;
      if (!day) day = await storage.createDay(characterId, window);
      const activeRun = day.activeRunId ? await storage.getRun(day.activeRunId, characterId) : null;
      if (activeRun && ["complete", "empty"].includes(activeRun.status) && trigger !== "manual-generate") return day;
      if (!activeRun || trigger === "manual-generate") {
        const sources = await discoverCharacterDailyMemorySources(args.db, characterId, window);
        const run = await storage.createRun(
          { dayId: day.id, kind: trigger, sourceConversationIds: sources.map((source) => source.id) },
          characterId,
        );
        await storage.setActiveRun(day.id, run.id, "pending", characterId);
        for (const source of sources)
          await storage.createRunSource(
            { runId: run.id, sourceConversationId: source.id, sourceConversationName: source.name },
            characterId,
          );
        day = (await storage.getDay(day.id, characterId))!;
        return this.runCharacterMemoryDay(run.id, characterId);
      }
      return this.runCharacterMemoryDay(activeRun.id, characterId);
    },
    async runCharacterMemoryDay(runId: string, characterId?: string, options: { activate?: boolean } = {}) {
      const activate = options.activate ?? true;
      const run = await storage.getRun(runId, characterId);
      if (!run) throw new Error("Daily memory run was not found");
      const day = await storage.getDay(run.dayId, characterId);
      if (!day) throw new Error("Daily memory day was not found");
      const targetRows = await args.db
        .select({ data: characters.data })
        .from(characters)
        .where(eq(characters.id, characterId ?? day.characterId));
      const targetName = characterName(targetRows[0], "Character");
      const settings = await storage.getSettings(characterId ?? day.characterId);
      const formation = await resolveFormationConnection(args.db, settings?.formationConnectionId);
      if (!formation) {
        await storage.updateRun(run.id, { status: "failed" }, day.characterId);
        if (activate) await storage.setActiveRun(day.id, run.id, "failed", day.characterId);
        return storage.getDay(day.id, day.characterId);
      }
      await storage.updateRun(
        run.id,
        {
          status: "running",
          startedAt: run.startedAt ?? now(),
          connectionId: formation.connectionId,
          model: formation.model,
        },
        day.characterId,
      );
      const sources = await storage.listRunSources(run.id, day.characterId);
      const prompt =
        settings?.formationPrompt?.trim() ||
        "Review this Conversation for the target character and return nuanced memories when warranted.";
      for (const source of sources) {
        if (source.status === "success" || source.status === "empty") continue;
        await processSource(day.characterId, run.id, source, targetName, formation, prompt, {
          dayKey: day.dayKey,
          windowStartAt: day.windowStartAt,
          windowEndAt: day.windowEndAt,
          timeZone: day.timeZone ?? undefined,
          handoverTime: day.handoverTime,
        });
      }
      const finalSources = await storage.listRunSources(run.id, day.characterId);
      const failed = finalSources.some(
        (source) => source.status === "failed" || source.status === "pending" || source.status === "running",
      );
      const memories = await storage.listMemories(day.characterId, { runId: run.id });
      const status = failed
        ? finalSources.some((source) => ["success", "empty"].includes(source.status))
          ? "partial"
          : "failed"
        : memories.length
          ? "complete"
          : "empty";
      await storage.updateRun(run.id, { status, completedAt: failed ? null : now() }, day.characterId);
      if (activate) await storage.setActiveRun(day.id, day.activeRunId ?? run.id, status, day.characterId);
      return storage.getDay(day.id, day.characterId);
    },
    async retryRunSource(runSourceId: string, characterId: string) {
      const source = await storage.getRunSource(runSourceId, characterId);
      if (!source) throw new Error("Daily memory source was not found");
      const run = await storage.getRun(source.runId, characterId);
      if (!run) throw new Error("Daily memory run was not found");
      return this.runCharacterMemoryDay(run.id, characterId);
    },
    async regenerateCharacterMemoryDay(dayId: string, characterId: string) {
      const day = await storage.getDay(dayId, characterId);
      if (!day) throw new Error("Daily memory day was not found");
      if (!["complete", "empty", "failed", "partial"].includes(day.status)) {
        throw new Error("Only completed or previously attempted Daily Memory days can be regenerated");
      }
      const sources = await discoverCharacterDailyMemorySources(args.db, characterId, {
        dayKey: day.dayKey,
        windowStartAt: day.windowStartAt,
        windowEndAt: day.windowEndAt,
        timeZone: day.timeZone ?? undefined,
        handoverTime: day.handoverTime,
      });
      const run = await storage.createRun(
        {
          dayId: day.id,
          kind: "regenerate",
          sourceConversationIds: sources.map((source) => source.id),
          replacementOfRunId: day.activeRunId,
        },
        characterId,
      );
      for (const source of sources)
        await storage.createRunSource(
          { runId: run.id, sourceConversationId: source.id, sourceConversationName: source.name },
          characterId,
        );
      const result = await this.runCharacterMemoryDay(run.id, characterId, { activate: false });
      const completed = result && ["complete", "empty"].includes(result.status);
      if (!completed) return result;
      const oldRunId = day.activeRunId;
      await storage.setActiveRun(day.id, run.id, result.status, characterId);
      if (oldRunId && oldRunId !== run.id) await storage.deleteRun(oldRunId, characterId);
      return storage.getDay(day.id, characterId);
    },
  };
}
