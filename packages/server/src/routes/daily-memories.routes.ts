import type { FastifyInstance } from "fastify";
import { formatZonedConversationDate, resolveConversationTimeZone } from "../services/conversation/timezone.js";
import {
  buildCompletedDailyMemoryBuckets,
  buildDailyMemoryRetrievalQuery,
  generateAndReplaceDailyMemoryDay,
  listDailyMemoryDays,
  replaceDailyMemoryDay,
  retrieveDailyMemories,
  type DailyMemoryDraft,
} from "../services/conversation/daily-memory.service.js";
import { resolveDailyMemoryAgentRuntime } from "../services/generation/daily-memory-agent-runtime.js";
import { resolveMemoryRecallEmbeddingSource } from "../services/memory-recall-embedding.js";
import { createAgentsStorage } from "../services/storage/agents.storage.js";
import { createCharactersStorage } from "../services/storage/characters.storage.js";
import { createChatsStorage } from "../services/storage/chats.storage.js";
import { createConnectionsStorage } from "../services/storage/connections.storage.js";
import { resolveBaseUrl } from "./generate/generate-route-utils.js";

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

function scopedVisibleMessages(messages: any[]) {
  let startIndex = 0;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (parseRecord(messages[index]?.extra).isConversationStart === true) {
      startIndex = index;
      break;
    }
  }
  return messages.slice(startIndex).filter((message) => parseRecord(message.extra).hiddenFromAI !== true);
}

async function participantNames(
  characters: ReturnType<typeof createCharactersStorage>,
  chat: { characterIds: unknown; personaId?: string | null },
) {
  let characterIds: unknown[] = [];
  if (Array.isArray(chat.characterIds)) characterIds = chat.characterIds;
  else if (typeof chat.characterIds === "string") {
    try {
      const parsed = JSON.parse(chat.characterIds);
      if (Array.isArray(parsed)) characterIds = parsed;
    } catch {
      characterIds = [];
    }
  }
  const characterNames = new Map<string, string>();
  for (const characterId of characterIds) {
    if (typeof characterId !== "string") continue;
    const row = await characters.getById(characterId);
    if (!row) continue;
    const data = parseRecord(row.data);
    characterNames.set(characterId, typeof data.name === "string" && data.name.trim() ? data.name : "Character");
  }
  const personas = await characters.listPersonas();
  const persona =
    (chat.personaId ? personas.find((candidate) => candidate.id === chat.personaId) : null) ??
    personas.find((candidate) => candidate.isActive === "true");
  return { characterNames, personaName: persona?.name ?? "User" };
}

export async function dailyMemoriesRoutes(app: FastifyInstance) {
  const chats = createChatsStorage(app.db);
  const agents = createAgentsStorage(app.db);
  const connections = createConnectionsStorage(app.db);
  const characters = createCharactersStorage(app.db);

  async function context(chatId: string) {
    const chat = await chats.getById(chatId);
    if (!chat || chat.mode !== "conversation") return null;
    const metadata = parseRecord(chat.metadata);
    const activeConnection = chat.connectionId ? await connections.getWithKey(chat.connectionId) : null;
    const runtime = await resolveDailyMemoryAgentRuntime({
      agents,
      connections,
      chatMetadata: metadata,
      activeConnection,
      activeBaseUrl: activeConnection ? resolveBaseUrl(activeConnection) : null,
      resolveBaseUrl,
    });
    if (!runtime) return { chat, metadata, runtime: null };
    const timeZone = resolveConversationTimeZone(metadata);
    const messages = scopedVisibleMessages(await chats.listMessages(chatId));
    const buckets = buildCompletedDailyMemoryBuckets({
      messages,
      timeZone,
      handoverHour: runtime.settings.handoverHour,
    });
    const embeddingSource = await resolveMemoryRecallEmbeddingSource(app.db, {
      chatMetadata: metadata,
      activeConnection,
      activeBaseUrl: activeConnection ? resolveBaseUrl(activeConnection) : null,
    });
    const names = await participantNames(characters, chat);
    return { chat, metadata, runtime, timeZone, messages, buckets, embeddingSource, ...names };
  }

  app.get<{ Params: { id: string } }>("/:id/daily-memories", async (request, reply) => {
    const value = await context(request.params.id);
    if (!value) return reply.status(404).send({ error: "Conversation not found" });
    if (!value.runtime) return reply.status(409).send({ error: "Daily Conversation Memories agent is not enabled" });
    return {
      handoverHour: value.runtime.settings.handoverHour,
      currentWindowDate: formatZonedConversationDate(new Date(), value.timeZone, value.runtime.settings.handoverHour),
      days: await listDailyMemoryDays({ db: app.db, chatId: request.params.id, buckets: value.buckets }),
    };
  });

  app.get<{ Params: { id: string } }>("/:id/daily-memories/preview", async (request, reply) => {
    const value = await context(request.params.id);
    if (!value) return reply.status(404).send({ error: "Conversation not found" });
    if (!value.runtime) return reply.status(409).send({ error: "Daily Conversation Memories agent is not enabled" });
    const queryMessages = buildDailyMemoryRetrievalQuery(value.messages, value.runtime.settings.retrievalMessageCount);
    const memories =
      queryMessages.length > 0
        ? await retrieveDailyMemories({
            db: app.db,
            chatId: request.params.id,
            query: queryMessages.join("\n"),
            settings: value.runtime.settings,
            embeddingSource: value.embeddingSource,
          })
        : [];
    return {
      retrievalMessageCount: value.runtime.settings.retrievalMessageCount,
      queryMessages,
      memories,
    };
  });

  app.put<{ Params: { id: string; date: string } }>("/:id/daily-memories/:date", async (request, reply) => {
    const value = await context(request.params.id);
    if (!value) return reply.status(404).send({ error: "Conversation not found" });
    if (!value.runtime) return reply.status(409).send({ error: "Daily Conversation Memories agent is not enabled" });
    if (!value.buckets.some((bucket) => bucket.date === request.params.date)) {
      return reply.status(400).send({ error: "Only completed Conversation days can be edited" });
    }
    const body = request.body as { memories?: DailyMemoryDraft[] };
    if (!Array.isArray(body?.memories) || body.memories.length > 200) {
      return reply.status(400).send({ error: "Invalid daily memories payload" });
    }
    const memories = await replaceDailyMemoryDay({
      db: app.db,
      chatId: request.params.id,
      date: request.params.date,
      memories: body.memories,
      embeddingSource: value.embeddingSource,
    });
    return { date: request.params.date, memories };
  });

  app.post<{ Params: { id: string; date: string } }>("/:id/daily-memories/:date/generate", async (request, reply) => {
    const value = await context(request.params.id);
    if (!value) return reply.status(404).send({ error: "Conversation not found" });
    if (!value.runtime) return reply.status(409).send({ error: "Daily Conversation Memories agent is not enabled" });
    const bucket = value.buckets.find((candidate) => candidate.date === request.params.date);
    if (!bucket) return reply.status(400).send({ error: "Only completed Conversation days can be generated" });
    const memories = await generateAndReplaceDailyMemoryDay({
      db: app.db,
      chatId: request.params.id,
      bucket,
      provider: value.runtime.provider,
      model: value.runtime.model,
      prompt: value.runtime.prompt,
      personaName: value.personaName,
      characterNames: value.characterNames,
      embeddingSource: value.embeddingSource,
    });
    return { date: request.params.date, memories };
  });
}
