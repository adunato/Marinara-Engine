import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  CHARACTER_DAILY_MEMORY_DEFAULTS,
  CHARACTER_DAILY_MEMORY_DEFAULT_PROMPT,
  characterDailyMemorySettingsPatchSchema,
  type CharacterDailyMemorySettings,
  type CharacterDailyMemoryWindow,
} from "@marinara-engine/shared";
import { asc, eq } from "../db/file-query.js";
import { chats, messages } from "../db/schema/index.js";
import { createCharactersStorage } from "../services/storage/characters.storage.js";
import { createAppSettingsStorage } from "../services/storage/app-settings.storage.js";
import {
  createCharacterDailyMemoriesStorage,
  type CharacterDailyMemoriesStorage,
} from "../services/storage/character-daily-memories.storage.js";
import { createCharacterDailyMemoryFormationService } from "../services/character-daily-memories/formation.service.js";
import { createCharacterDailyMemoryEmbeddingService } from "../services/character-daily-memories/embedding.service.js";
import { getZonedDateParts, normalizePromptTimeZone } from "../services/conversation/timezone.js";
import {
  enumerateCompletedWindows,
  mostRecentCompletedWindow,
  resolveHandoverInstant,
} from "../services/character-daily-memories/window.js";

const routeIdSchema = z.string().trim().min(1).max(200);
const windowEndSchema = z.string().datetime({ offset: true });
const memoryTextSchema = z.string().trim().min(1).max(20_000);
const settingsPatchSchema = characterDailyMemorySettingsPatchSchema.extend({
  formationPrompt: z.string().trim().min(1).max(20_000).optional(),
  retrievalMessageCount: z.number().int().min(0).max(200).optional(),
  semanticWeight: z.number().finite().min(0).max(100).optional(),
  importanceWeight: z.number().finite().min(0).max(100).optional(),
  recencyWeight: z.number().finite().min(0).max(100).optional(),
  minimumRankPercent: z.number().finite().min(0).max(100).optional(),
  timeZone: z.string().trim().max(100).optional(),
});
const generateSchema = z.object({ windowEndAt: windowEndSchema });
const memoryCreateSchema = z.object({
  dayId: routeIdSchema.optional(),
  windowEndAt: windowEndSchema.optional(),
  text: memoryTextSchema,
  importance: z.number().int().min(1).max(5),
});
const memoryPatchSchema = z
  .object({ text: memoryTextSchema.optional(), importance: z.number().int().min(1).max(5).optional() })
  .refine((value) => value.text !== undefined || value.importance !== undefined, "At least one field is required");
const previewSchema = z.object({ chatId: routeIdSchema });

type PreviewRetriever = (input: {
  characterId: string;
  chatId: string;
  messages: Array<{ role: string; characterId: string | null; content: string; createdAt: string }>;
  settings: CharacterDailyMemorySettings;
}) => Promise<unknown>;

export type CharacterDailyMemoryRoutesOptions = {
  /** Supplied by the retrieval slice once ranking is available. */
  previewRetriever?: PreviewRetriever;
  /** Hook for scheduler refresh; intentionally optional during route-only integration. */
  onSettingsChanged?: (
    characterId: string,
    change: { connectionChanged: boolean; enabledChanged: boolean },
  ) => void | Promise<void>;
};

function readConversationTimeZone(value: string | null): string | undefined {
  if (!value) return undefined;
  try {
    const parsed: unknown = JSON.parse(value);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return undefined;
    return normalizePromptTimeZone((parsed as Record<string, unknown>).conversationTimeZone);
  } catch {
    return undefined;
  }
}

function parseHiddenMessageExtra(value: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function isVisibleMessage(message: { role: string; content: string; extra: string }, characterId: string) {
  if (!(message.role === "user" || message.role === "assistant" || message.role === "narrator")) return false;
  if (!message.content.trim()) return false;
  const extra = parseHiddenMessageExtra(message.extra);
  if (extra.hiddenFromAI === true) return false;
  return !(Array.isArray(extra.hiddenFromAICharacterIds) && extra.hiddenFromAICharacterIds.includes(characterId));
}

function containsCharacter(value: string, characterId: string) {
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) && parsed.includes(characterId);
  } catch {
    return false;
  }
}

function windowFromEnd(windowEndAt: string, handoverTime: string, timeZone?: string): CharacterDailyMemoryWindow {
  const end = new Date(windowEndAt);
  if (Number.isNaN(end.getTime())) throw new Error("windowEndAt must be a valid ISO instant");
  const parts = getZonedDateParts(end, timeZone);
  const expected = resolveHandoverInstant(parts, handoverTime, timeZone);
  if (expected.toISOString() !== end.toISOString()) {
    throw new Error("windowEndAt must match the configured handover time");
  }
  return {
    dayKey: `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`,
    windowStartAt: new Date(end.getTime() - 24 * 60 * 60 * 1000).toISOString(),
    windowEndAt: end.toISOString(),
    timeZone,
    handoverTime,
  };
}

function defaultSettings(characterId: string): CharacterDailyMemorySettings {
  const timestamp = new Date().toISOString();
  return {
    characterId,
    enabled: false,
    handoverTime: CHARACTER_DAILY_MEMORY_DEFAULTS.handoverTime,
    formationConnectionId: null,
    formationPrompt: CHARACTER_DAILY_MEMORY_DEFAULT_PROMPT,
    retrievalMessageCount: CHARACTER_DAILY_MEMORY_DEFAULTS.retrievalMessageCount,
    semanticWeight: CHARACTER_DAILY_MEMORY_DEFAULTS.semanticWeight,
    importanceWeight: CHARACTER_DAILY_MEMORY_DEFAULTS.importanceWeight,
    recencyWeight: CHARACTER_DAILY_MEMORY_DEFAULTS.recencyWeight,
    minimumRankPercent: CHARACTER_DAILY_MEMORY_DEFAULTS.minimumRankPercent,
    autoStartWindowEndAt: null,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

async function ensureCharacter(app: FastifyInstance, characterId: string) {
  const character = await createCharactersStorage(app.db).getById(characterId);
  return character;
}

async function expandedDay(
  storage: CharacterDailyMemoriesStorage,
  characterId: string,
  day: Awaited<ReturnType<CharacterDailyMemoriesStorage["getDay"]>>,
) {
  if (!day) return null;
  const runs = await storage.listRuns(day.id, characterId);
  const activeRun = day.activeRunId ? await storage.getRun(day.activeRunId, characterId) : null;
  const sources = activeRun ? await storage.listRunSources(activeRun.id, characterId) : [];
  const memories = activeRun ? await storage.listMemories(characterId, { runId: activeRun.id }) : [];
  return { day, run: activeRun, sources, memories, runs };
}

async function sourceHistoryStart(app: FastifyInstance, characterId: string) {
  const candidateChats = await app.db.select().from(chats).where(eq(chats.mode, "conversation"));
  let first: string | null = null;
  for (const chat of candidateChats) {
    if (!containsCharacter(chat.characterIds, characterId)) continue;
    const rows = await app.db
      .select({ createdAt: messages.createdAt, role: messages.role, content: messages.content, extra: messages.extra })
      .from(messages)
      .where(eq(messages.chatId, chat.id))
      .orderBy(asc(messages.createdAt));
    for (const row of rows) {
      if (!isVisibleMessage(row, characterId)) continue;
      if (first === null || row.createdAt < first) first = row.createdAt;
    }
  }
  return first;
}

export async function characterDailyMemoriesRoutes(
  app: FastifyInstance,
  options: CharacterDailyMemoryRoutesOptions = {},
) {
  const storage = createCharacterDailyMemoriesStorage(app.db);
  const formation = createCharacterDailyMemoryFormationService({ db: app.db, storage });
  const embedding = await createCharacterDailyMemoryEmbeddingService({ db: app.db, storage });
  const appSettings = createAppSettingsStorage(app.db);
  const settingsMutations = new Map<string, Promise<unknown>>();

  async function serializeSettingsMutation<T>(characterId: string, mutation: () => Promise<T>): Promise<T> {
    const previous = settingsMutations.get(characterId) ?? Promise.resolve();
    const current = previous.catch(() => undefined).then(mutation);
    settingsMutations.set(characterId, current);
    try {
      return await current;
    } finally {
      if (settingsMutations.get(characterId) === current) settingsMutations.delete(characterId);
    }
  }

  const settingsFor = async (characterId: string) =>
    (await storage.getSettings(characterId)) ?? defaultSettings(characterId);
  const timezoneFor = async () => readConversationTimeZone(await appSettings.get("ui"));

  app.get<{ Params: { characterId: string } }>("/:characterId/daily-memories/settings", async (req, reply) => {
    if (!(await ensureCharacter(app, req.params.characterId)))
      return reply.status(404).send({ error: "Character not found" });
    return settingsFor(req.params.characterId);
  });

  app.patch<{ Params: { characterId: string } }>("/:characterId/daily-memories/settings", async (req, reply) => {
    const characterId = req.params.characterId;
    if (!(await ensureCharacter(app, characterId))) return reply.status(404).send({ error: "Character not found" });
    const patch = settingsPatchSchema.parse(req.body);
    if (patch.timeZone !== undefined && !normalizePromptTimeZone(patch.timeZone)) {
      return reply.status(400).send({ error: "timeZone must be a valid IANA timezone" });
    }
    return serializeSettingsMutation(characterId, async () => {
      const previous = await storage.getSettings(characterId);
      const saved = await storage.saveSettings(characterId, {
        ...patch,
        timeZone: patch.timeZone ?? (await timezoneFor()),
      });
      const connectionChanged =
        patch.formationConnectionId !== undefined && patch.formationConnectionId !== previous?.formationConnectionId;
      if (connectionChanged) await embedding.revectorizeCharacter(characterId, patch.formationConnectionId);
      await options.onSettingsChanged?.(characterId, {
        connectionChanged,
        enabledChanged: patch.enabled !== undefined && patch.enabled !== (previous?.enabled ?? false),
      });
      return saved;
    });
  });

  app.get<{ Params: { characterId: string } }>("/:characterId/daily-memories/days", async (req, reply) => {
    const characterId = req.params.characterId;
    if (!(await ensureCharacter(app, characterId))) return reply.status(404).send({ error: "Character not found" });
    const settings = await settingsFor(characterId);
    const timeZone = await timezoneFor();
    const persisted = await storage.listDays(characterId);
    const days = (await Promise.all(persisted.map((day) => expandedDay(storage, characterId, day)))).filter(Boolean);
    const missingDays: Array<CharacterDailyMemoryWindow & { characterId: string; reason: "missing" | "deleted" }> = [];
    const firstMessageAt = await sourceHistoryStart(app, characterId);
    if (firstMessageAt) {
      const firstWindow = mostRecentCompletedWindow(firstMessageAt, settings.handoverTime, timeZone);
      const windows = enumerateCompletedWindows(firstWindow.windowEndAt, new Date(), settings.handoverTime, timeZone);
      const persistedByEnd = new Map(persisted.map((day) => [day.windowEndAt, day]));
      for (const window of windows) {
        const existing = persistedByEnd.get(window.windowEndAt);
        if (existing) {
          if (existing.status === "deleted") missingDays.push({ ...window, characterId, reason: "deleted" });
          continue;
        }
        const sources = await formation.discoverSources(characterId, window);
        if (sources.length) missingDays.push({ ...window, characterId, reason: "missing" });
      }
    }
    return { days, missingDays };
  });

  app.post<{ Params: { characterId: string } }>("/:characterId/daily-memories/generate", async (req, reply) => {
    const characterId = req.params.characterId;
    if (!(await ensureCharacter(app, characterId))) return reply.status(404).send({ error: "Character not found" });
    const input = generateSchema.parse(req.body);
    const settings = await settingsFor(characterId);
    let window: CharacterDailyMemoryWindow;
    try {
      window = windowFromEnd(input.windowEndAt, settings.handoverTime, await timezoneFor());
    } catch (error) {
      return reply.status(400).send({ error: error instanceof Error ? error.message : "Invalid memory window" });
    }
    if (new Date(window.windowEndAt).getTime() > new Date().getTime()) {
      return reply.status(400).send({ error: "Cannot generate the current incomplete window" });
    }
    const day = await formation.ensureCharacterMemoryDay(characterId, window, "manual-generate");
    return expandedDay(storage, characterId, day);
  });

  app.post<{ Params: { characterId: string; dayId: string } }>(
    "/:characterId/daily-memories/days/:dayId/regenerate",
    async (req, reply) => {
      const characterId = req.params.characterId;
      if (!(await ensureCharacter(app, characterId))) return reply.status(404).send({ error: "Character not found" });
      const day = await storage.getDay(req.params.dayId, characterId);
      if (!day) return reply.status(404).send({ error: "Daily memory day not found" });
      try {
        const result = await formation.regenerateCharacterMemoryDay(day.id, characterId);
        return expandedDay(storage, characterId, result);
      } catch (error) {
        return reply.status(400).send({ error: error instanceof Error ? error.message : "Regeneration failed" });
      }
    },
  );

  app.delete<{ Params: { characterId: string; dayId: string } }>(
    "/:characterId/daily-memories/days/:dayId",
    async (req, reply) => {
      const characterId = req.params.characterId;
      if (!(await ensureCharacter(app, characterId))) return reply.status(404).send({ error: "Character not found" });
      const day = await storage.getDay(req.params.dayId, characterId);
      if (!day) return reply.status(404).send({ error: "Daily memory day not found" });
      const runs = await storage.listRuns(day.id, characterId);
      for (const run of runs) await storage.deleteRun(run.id, characterId);
      await storage.markDayDeleted(day.id, characterId);
      return reply.send({ success: true });
    },
  );

  app.post<{ Params: { characterId: string } }>("/:characterId/daily-memories/memories", async (req, reply) => {
    const characterId = req.params.characterId;
    if (!(await ensureCharacter(app, characterId))) return reply.status(404).send({ error: "Character not found" });
    const input = memoryCreateSchema.parse(req.body);
    const settings = await settingsFor(characterId);
    let day = input.dayId ? await storage.getDay(input.dayId, characterId) : null;
    if (input.dayId && !day) return reply.status(404).send({ error: "Daily memory day not found" });
    if (!day) {
      try {
        const window = input.windowEndAt
          ? windowFromEnd(input.windowEndAt, settings.handoverTime, await timezoneFor())
          : mostRecentCompletedWindow(new Date(), settings.handoverTime, await timezoneFor());
        day = await storage.createDay(characterId, window, "complete");
      } catch (error) {
        return reply.status(400).send({ error: error instanceof Error ? error.message : "Invalid memory window" });
      }
    }
    let run = day.activeRunId ? await storage.getRun(day.activeRunId, characterId) : null;
    if (!run) {
      run = await storage.createRun({ dayId: day.id, kind: "manual-only", status: "complete" }, characterId);
      await storage.setActiveRun(day.id, run.id, "complete", characterId);
    }
    const vector = await embedding.embedText(input.text, settings.formationConnectionId);
    const memory = await storage.createMemory(
      {
        characterId,
        dayId: day.id,
        runId: run.id,
        origin: "manual",
        text: input.text,
        importance: input.importance,
        embedding: vector?.embedding ?? null,
        embeddingSpaceId: vector?.embeddingSpaceId ?? null,
      },
      characterId,
    );
    await storage.updateRun(run.id, { status: "complete", completedAt: new Date().toISOString() }, characterId);
    await storage.updateDay(day.id, { status: "complete", activeRunId: run.id }, characterId);
    return memory;
  });

  app.patch<{ Params: { characterId: string; memoryId: string } }>(
    "/:characterId/daily-memories/memories/:memoryId",
    async (req, reply) => {
      const characterId = req.params.characterId;
      if (!(await ensureCharacter(app, characterId))) return reply.status(404).send({ error: "Character not found" });
      const input = memoryPatchSchema.parse(req.body);
      const current = (await storage.listMemories(characterId)).find((memory) => memory.id === req.params.memoryId);
      if (!current) return reply.status(404).send({ error: "Daily memory not found" });
      const vector =
        input.text !== undefined
          ? await embedding.embedText(input.text, (await settingsFor(characterId)).formationConnectionId)
          : { embedding: current.embedding, embeddingSpaceId: current.embeddingSpaceId };
      return storage.updateMemory(
        req.params.memoryId,
        {
          ...input,
          embedding: vector?.embedding ?? null,
          embeddingSpaceId: vector?.embeddingSpaceId ?? null,
        },
        characterId,
      );
    },
  );

  app.delete<{ Params: { characterId: string; memoryId: string } }>(
    "/:characterId/daily-memories/memories/:memoryId",
    async (req, reply) => {
      const characterId = req.params.characterId;
      if (!(await ensureCharacter(app, characterId))) return reply.status(404).send({ error: "Character not found" });
      const current = (await storage.listMemories(characterId)).find((memory) => memory.id === req.params.memoryId);
      if (!current) return reply.status(404).send({ error: "Daily memory not found" });
      await storage.deleteMemory(req.params.memoryId, characterId);
      return reply.send({ success: true });
    },
  );

  app.get<{ Params: { characterId: string }; Querystring: { dayId?: string; windowEndAt?: string } }>(
    "/:characterId/daily-memories/conversations",
    async (req, reply) => {
      const characterId = req.params.characterId;
      if (!(await ensureCharacter(app, characterId))) return reply.status(404).send({ error: "Character not found" });
      const settings = await settingsFor(characterId);
      const day = req.query.dayId ? await storage.getDay(req.query.dayId, characterId) : null;
      if (req.query.dayId && !day) return reply.status(404).send({ error: "Daily memory day not found" });
      const end =
        day?.windowEndAt ??
        req.query.windowEndAt ??
        mostRecentCompletedWindow(new Date(), settings.handoverTime, await timezoneFor()).windowEndAt;
      let window: CharacterDailyMemoryWindow;
      try {
        window = windowFromEnd(end, day?.handoverTime ?? settings.handoverTime, day?.timeZone ?? (await timezoneFor()));
      } catch (error) {
        return reply.status(400).send({ error: error instanceof Error ? error.message : "Invalid memory window" });
      }
      const sources = await formation.discoverSources(characterId, window);
      return {
        conversations: sources.map((source) => ({
          id: source.id,
          name: source.name,
          firstEligibleMessageAt: source.firstEligibleMessageAt,
        })),
      };
    },
  );

  app.post<{ Params: { characterId: string } }>("/:characterId/daily-memories/preview", async (req, reply) => {
    const characterId = req.params.characterId;
    if (!(await ensureCharacter(app, characterId))) return reply.status(404).send({ error: "Character not found" });
    const input = previewSchema.parse(req.body);
    const chatRows = await app.db.select().from(chats).where(eq(chats.id, input.chatId));
    const chat = chatRows[0];
    if (!chat || chat.mode !== "conversation" || !containsCharacter(chat.characterIds, characterId)) {
      return reply.status(404).send({ error: "Qualifying Conversation not found" });
    }
    const settings = await settingsFor(characterId);
    const chatMessages = await app.db
      .select()
      .from(messages)
      .where(eq(messages.chatId, input.chatId))
      .orderBy(asc(messages.createdAt));
    const visible = chatMessages.filter((message) => isVisibleMessage(message, characterId));
    const recentMessages = visible.slice(-settings.retrievalMessageCount);
    if (options.previewRetriever) {
      return options.previewRetriever({
        characterId,
        chatId: input.chatId,
        messages: recentMessages.map((message) => ({
          role: message.role,
          characterId: message.characterId ?? null,
          content: message.content,
          createdAt: message.createdAt,
        })),
        settings,
      });
    }
    const memories = await storage.listMemories(characterId, { activeOnly: true });
    const eligible = memories.filter((memory) => memory.embedding && memory.embeddingSpaceId);
    return {
      chatId: input.chatId,
      memories: eligible,
      diagnostics: { retrievalAvailable: false, candidateCount: eligible.length },
    };
  });
}
