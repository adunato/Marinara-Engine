import {
  DAILY_INTENTION_AREA_KEYS,
  type DailyIntentionAreaKey,
  type DailyIntentionOutput,
  type DailyIntentionsResponse,
} from "@marinara-engine/shared";
import type { FastifyInstance } from "fastify";

import {
  dailyIntentionsEligibility,
  findDailyIntentionArea,
  generateDailyIntention,
  isDailyIntentionsAgentActive,
  normalizeDailyIntentionsSettings,
  normalizeDailyIntentionsState,
  replaceDailyIntentionOutput,
  stripDailyIntentionsContext,
} from "../services/conversation/daily-intentions.service.js";
import { listDailyMemoryDays } from "../services/conversation/daily-memory.service.js";
import type { ChatMessage } from "../services/llm/base-provider.js";
import { withConnectionFallbackProvider } from "../services/llm/connection-fallback-provider.js";
import { createLLMProvider } from "../services/llm/provider-registry.js";
import { createCharactersStorage } from "../services/storage/characters.storage.js";
import { createChatsStorage } from "../services/storage/chats.storage.js";
import { createConnectionsStorage } from "../services/storage/connections.storage.js";
import { resolveBaseUrl } from "./generate/generate-route-utils.js";

const runningAllChats = new Set<string>();
const runningAreasByChat = new Map<string, Set<DailyIntentionAreaKey>>();
const DAILY_INTENTIONS_MESSAGE_WINDOW_MS = 24 * 60 * 60 * 1000;

function parseRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  if (typeof value !== "string" || !value.trim()) return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function parseCharacterIds(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((id): id is string => typeof id === "string" && !!id.trim());
  if (typeof value !== "string") return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === "string" && !!id.trim()) : [];
  } catch {
    return [];
  }
}

function isVisibleMessage(message: any): boolean {
  const extra = parseRecord(message?.extra);
  return extra.hiddenFromAI !== true;
}

function mapMessage(message: any): ChatMessage | null {
  const role = message?.role === "narrator" ? "system" : message?.role;
  if (role !== "system" && role !== "user" && role !== "assistant") return null;
  const content = typeof message.content === "string" ? stripDailyIntentionsContext(message.content) : "";
  return content.trim() ? { role, content } : null;
}

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message.trim() ? error.message : "Daily Intention generation failed";
}

export async function dailyIntentionsRoutes(app: FastifyInstance) {
  const chats = createChatsStorage(app.db);
  const characters = createCharactersStorage(app.db);
  const connections = createConnectionsStorage(app.db);

  async function loadContext(chatId: string) {
    const chat = await chats.getById(chatId);
    if (!chat || chat.mode !== "conversation") return null;
    const metadata = parseRecord(chat.metadata);
    const characterIds = parseCharacterIds(chat.characterIds);
    const eligibility = dailyIntentionsEligibility(characterIds);
    const state = normalizeDailyIntentionsState(metadata.dailyIntentions);
    let characterName: string | null = null;
    if (characterIds[0]) {
      const character = await characters.getById(characterIds[0]);
      const data = parseRecord(character?.data);
      characterName = typeof data.name === "string" && data.name.trim() ? data.name.trim() : "Character";
    }
    return {
      chat,
      metadata,
      characterIds,
      eligibility,
      state,
      characterId: characterIds[0] ?? null,
      characterName,
      active: isDailyIntentionsAgentActive(metadata),
    };
  }

  function response(value: NonNullable<Awaited<ReturnType<typeof loadContext>>>): DailyIntentionsResponse {
    return {
      active: value.active,
      eligible: value.eligibility.eligible,
      eligibilityError: value.eligibility.error,
      characterId: value.characterId,
      characterName: value.characterName,
      settings: value.state.settings,
      outputs: value.state.outputs,
    };
  }

  async function resolveProvider(value: NonNullable<Awaited<ReturnType<typeof loadContext>>>) {
    const requested =
      (value.state.settings.connectionId
        ? await connections.getWithKey(value.state.settings.connectionId)
        : null) ??
      (await connections.getDefaultForAgents()) ??
      (value.chat.connectionId ? await connections.getWithKey(value.chat.connectionId) : null);
    if (!requested?.model) throw new Error("Choose a valid Daily Intentions generation connection");
    const baseUrl = resolveBaseUrl(requested);
    if (!baseUrl) throw new Error("The Daily Intentions connection has no usable base URL");
    const primary = createLLMProvider(
      requested.provider,
      baseUrl,
      requested.apiKey,
      requested.maxContext,
      requested.openrouterProvider,
      requested.maxTokensOverride,
      requested.claudeFastMode === "true",
      requested.treatAsLocalEndpoint === "true",
      requested.defaultParameters,
    );
    const fallback = await connections.getFallbackForAgents();
    return {
      provider: withConnectionFallbackProvider({
        primary,
        primaryConnectionId: requested.id,
        fallbackConnection: fallback,
        fallbackBaseUrl: fallback ? resolveBaseUrl(fallback) : "",
        category: "agents",
      }),
      model: requested.model,
    };
  }

  async function buildContextSnapshot(
    value: NonNullable<Awaited<ReturnType<typeof loadContext>>>,
  ): Promise<ChatMessage[]> {
    const snapshotAt = Date.now();
    const allMessages = await chats.listMessages(value.chat.id);
    let conversationStartIndex = 0;
    for (let index = allMessages.length - 1; index >= 0; index -= 1) {
      if (parseRecord(allMessages[index]?.extra).isConversationStart === true) {
        conversationStartIndex = index;
        break;
      }
    }
    const recentMessages = allMessages
      .slice(conversationStartIndex)
      .filter(isVisibleMessage)
      .filter((message) => {
        const createdAt = Date.parse(message.createdAt);
        return (
          Number.isFinite(createdAt) &&
          createdAt >= snapshotAt - DAILY_INTENTIONS_MESSAGE_WINDOW_MS &&
          createdAt <= snapshotAt
        );
      })
      .flatMap((message) => {
        const mapped = mapMessage(message);
        return mapped ? [mapped] : [];
      });

    const character = value.characterId ? await characters.getById(value.characterId) : null;
    const characterData = parseRecord(character?.data);
    const personas = await characters.listPersonas();
    const persona =
      (value.chat.personaId ? personas.find((candidate) => candidate.id === value.chat.personaId) : null) ??
      personas.find((candidate) => candidate.isActive === "true");
    const messages: ChatMessage[] = [
      {
        role: "system",
        content: `<character_identity>\n${JSON.stringify(
          {
            character: characterData,
            persona: persona
              ? {
                  name: persona.name,
                  description: persona.description,
                  personality: persona.personality,
                  scenario: persona.scenario,
                  backstory: persona.backstory,
                  appearance: persona.appearance,
                  aboutMe: persona.aboutMe,
                }
              : null,
          },
          null,
          2,
        )}\n</character_identity>`,
        contextKind: "injection",
      },
    ];

    if (value.metadata.summary || value.metadata.summaryEntries) {
      messages.push({
        role: "system",
        content: `<conversation_summaries>\n${JSON.stringify(
          {
            summary: value.metadata.summary ?? null,
            summaryEntries: value.metadata.summaryEntries ?? null,
          },
          null,
          2,
        )}\n</conversation_summaries>`,
        contextKind: "injection",
      });
    }

    try {
      const dailyMemoryDays = await listDailyMemoryDays({ db: app.db, chatId: value.chat.id, buckets: [] });
      const dailyMemories = dailyMemoryDays.flatMap((day) =>
        day.memories.map((memory) => `[${day.date}] ${memory.memory.trim()}`).filter((memory) => !!memory.trim()),
      );
      if (dailyMemories.length > 0) {
        messages.push({
          role: "system",
          content: `<daily_memories>\n${dailyMemories.join("\n\n")}\n</daily_memories>`,
          contextKind: "injection",
        });
      }
    } catch {
      // Daily Memories is optional; identity, summaries, and the 24-hour transcript remain valid.
    }

    return [...messages, ...recentMessages].map((message) => ({
      ...message,
      content: stripDailyIntentionsContext(message.content),
    }));
  }

  async function persistOutput(chatId: string, key: DailyIntentionAreaKey, content: string) {
    let output: DailyIntentionOutput | null = null;
    await chats.patchMetadata(chatId, (current) => {
      const state = normalizeDailyIntentionsState(current.dailyIntentions);
      const next = replaceDailyIntentionOutput(state, key, content);
      output = next.outputs[key] ?? null;
      return { dailyIntentions: next };
    });
    return output;
  }

  async function generateArea(
    value: NonNullable<Awaited<ReturnType<typeof loadContext>>>,
    key: DailyIntentionAreaKey,
    contextMessages: ChatMessage[],
  ) {
    const area = findDailyIntentionArea(value.state.settings, key);
    if (!area) throw new Error("Unknown Daily Intentions area");
    if (!area.enabled) throw new Error(`${area.heading} is disabled`);
    const runtime = await resolveProvider(value);
    const content = await generateDailyIntention({
      ...runtime,
      area,
      characterName: value.characterName ?? "Character",
      contextMessages,
    });
    return persistOutput(value.chat.id, key, content);
  }

  app.get<{ Params: { id: string } }>("/:id/daily-intentions", async (request, reply) => {
    const value = await loadContext(request.params.id);
    if (!value) return reply.status(404).send({ error: "Conversation not found" });
    return response(value);
  });

  app.put<{ Params: { id: string } }>("/:id/daily-intentions/settings", async (request, reply) => {
    const value = await loadContext(request.params.id);
    if (!value) return reply.status(404).send({ error: "Conversation not found" });
    const body = parseRecord(request.body);
    const settings = normalizeDailyIntentionsSettings(body.settings ?? body);
    await chats.patchMetadata(value.chat.id, (current) => ({
      dailyIntentions: {
        ...normalizeDailyIntentionsState(current.dailyIntentions),
        settings,
      },
    }));
    const updated = await loadContext(value.chat.id);
    return response(updated!);
  });

  app.put<{ Params: { id: string } }>("/:id/daily-intentions/outputs", async (request, reply) => {
    const value = await loadContext(request.params.id);
    if (!value) return reply.status(404).send({ error: "Conversation not found" });
    const body = parseRecord(request.body);
    const input = parseRecord(body.outputs);
    await chats.patchMetadata(value.chat.id, (current) => {
      let state = normalizeDailyIntentionsState(current.dailyIntentions);
      for (const key of DAILY_INTENTION_AREA_KEYS) {
        if (!Object.prototype.hasOwnProperty.call(input, key)) continue;
        state = replaceDailyIntentionOutput(state, key, typeof input[key] === "string" ? input[key] : "");
      }
      return { dailyIntentions: state };
    });
    const updated = await loadContext(value.chat.id);
    return response(updated!);
  });

  app.post<{ Params: { id: string; key: string } }>(
    "/:id/daily-intentions/generate/:key",
    async (request, reply) => {
      const value = await loadContext(request.params.id);
      if (!value) return reply.status(404).send({ error: "Conversation not found" });
      if (!value.active) return reply.status(409).send({ error: "Daily Intentions agent is not enabled" });
      if (!value.eligibility.eligible) return reply.status(409).send({ error: value.eligibility.error });
      const key = request.params.key as DailyIntentionAreaKey;
      if (!DAILY_INTENTION_AREA_KEYS.includes(key)) return reply.status(400).send({ error: "Unknown area" });
      if (runningAllChats.has(value.chat.id) || runningAreasByChat.get(value.chat.id)?.has(key)) {
        return reply.status(409).send({ error: "This Daily Intentions area is already running" });
      }
      const running = runningAreasByChat.get(value.chat.id) ?? new Set<DailyIntentionAreaKey>();
      running.add(key);
      runningAreasByChat.set(value.chat.id, running);
      try {
        const output = await generateArea(value, key, await buildContextSnapshot(value));
        return { key, output, error: null };
      } catch (error) {
        return reply.status(502).send({ error: errorMessage(error) });
      } finally {
        running.delete(key);
        if (running.size === 0) runningAreasByChat.delete(value.chat.id);
      }
    },
  );

  app.post<{ Params: { id: string } }>("/:id/daily-intentions/generate-all", async (request, reply) => {
    const value = await loadContext(request.params.id);
    if (!value) return reply.status(404).send({ error: "Conversation not found" });
    if (!value.active) return reply.status(409).send({ error: "Daily Intentions agent is not enabled" });
    if (!value.eligibility.eligible) return reply.status(409).send({ error: value.eligibility.error });
    if (runningAllChats.has(value.chat.id) || runningAreasByChat.has(value.chat.id)) {
      return reply.status(409).send({ error: "Daily Intentions is already running for this Conversation" });
    }

    runningAllChats.add(value.chat.id);
    reply.hijack();
    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    });
    const send = (event: Record<string, unknown>) => {
      if (!reply.raw.destroyed) reply.raw.write(`data: ${JSON.stringify(event)}\n\n`);
    };
    try {
      const contextMessages = await buildContextSnapshot(value);
      for (const area of value.state.settings.areas) {
        if (!area.enabled) continue;
        send({ type: "area_started", key: area.key });
        try {
          const output = await generateArea(value, area.key, contextMessages);
          send({ type: "area_succeeded", key: area.key, output });
        } catch (error) {
          send({ type: "area_failed", key: area.key, error: errorMessage(error) });
        }
      }
      send({ type: "done" });
    } catch (error) {
      send({ type: "error", error: errorMessage(error) });
    } finally {
      runningAllChats.delete(value.chat.id);
      if (!reply.raw.destroyed) reply.raw.end();
    }
  });
}
