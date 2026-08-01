import {
  DEFAULT_DAILY_MEMORY_PROMPT,
  type DailyMemory,
  type DailyMemoryDay,
  type WrapFormat,
} from "@marinara-engine/shared";
import { and, eq, isNotNull } from "../../db/file-query.js";
import type { DB } from "../../db/connection.js";
import { emitDailyMemoryDayReplaced } from "./daily-memory-events.js";
import { dailyMemories, dailyMemoryDays } from "../../db/schema/index.js";
import { logger } from "../../lib/logger.js";
import { newId, now as nowIso } from "../../utils/id-generator.js";
import type { BaseLLMProvider } from "../llm/base-provider.js";
import { embedMemoryRecallTexts, type MemoryRecallEmbeddingSource } from "../memory-recall.js";
import { wrapContent } from "../prompt/format-engine.js";
import { sanitizePromptLeaf } from "../prompt/prompt-escaping.js";
import { stripConversationPromptTimestamps } from "./transcript-sanitize.js";
import { formatZonedConversationDate, getZonedDateParts, zonedWallClockToInstant } from "./timezone.js";

export const DAILY_MEMORY_DEFAULTS = {
  handoverHour: 4,
  retrievalMessageCount: 6,
  semanticWeight: 50,
  importanceWeight: 35,
  recencyWeight: 15,
  minimumRank: 30,
  recencyHalfLifeDays: 30,
} as const;

const DAY_MS = 24 * 60 * 60 * 1000;
const FORMATION_TIMEOUT_MS = 300_000;
const TRANSCRIPT_CHUNK_CHARS = 32_000;
const MAX_TRANSCRIPT_CHUNKS = 12;

export interface DailyMemorySettings {
  handoverHour: number;
  retrievalMessageCount: number;
  semanticWeight: number;
  importanceWeight: number;
  recencyWeight: number;
  minimumRank: number;
  recencyHalfLifeDays: number;
}

export interface DailyMemorySourceMessage {
  role: string;
  content: string | null;
  characterId?: string | null;
  createdAt?: string | null;
}

export interface DailyMemoryBucket {
  date: string;
  start: Date;
  end: Date;
  messages: DailyMemorySourceMessage[];
}

export interface DailyMemoryDraft {
  id?: string;
  memory: string;
  importance: number;
}

function finiteNumber(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function normalizeDailyMemorySettings(value: unknown): DailyMemorySettings {
  const settings =
    value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
  return {
    handoverHour: Math.max(0, Math.min(23, Math.floor(finiteNumber(settings.handoverHour, 4)))),
    retrievalMessageCount: Math.max(
      1,
      Math.min(50, Math.floor(finiteNumber(settings.retrievalMessageCount ?? settings.contextSize, 6))),
    ),
    semanticWeight: Math.max(0, Math.min(100, finiteNumber(settings.semanticWeight, 50))),
    importanceWeight: Math.max(0, Math.min(100, finiteNumber(settings.importanceWeight, 35))),
    recencyWeight: Math.max(0, Math.min(100, finiteNumber(settings.recencyWeight, 15))),
    minimumRank: Math.max(0, Math.min(100, finiteNumber(settings.minimumRank, 30))),
    recencyHalfLifeDays: Math.max(1, Math.min(3650, finiteNumber(settings.recencyHalfLifeDays, 30))),
  };
}

function previousCalendarDate(parts: { year: number; month: number; day: number }) {
  const value = new Date(Date.UTC(parts.year, parts.month - 1, parts.day - 1));
  return { year: value.getUTCFullYear(), month: value.getUTCMonth() + 1, day: value.getUTCDate() };
}

export function latestCompletedDailyMemoryHandover(
  now: Date,
  timeZone: string | undefined,
  handoverHour: number,
): Date {
  const parts = getZonedDateParts(now, timeZone);
  let calendar = { year: parts.year, month: parts.month, day: parts.day };
  let handover = zonedWallClockToInstant({ ...calendar, hour: handoverHour, minute: 0, second: 0 }, timeZone);
  if (handover.getTime() > now.getTime()) {
    calendar = previousCalendarDate(calendar);
    handover = zonedWallClockToInstant({ ...calendar, hour: handoverHour, minute: 0, second: 0 }, timeZone);
  }
  return handover;
}

function completedWindowDate(end: Date, timeZone: string | undefined, handoverHour: number): string {
  return formatZonedConversationDate(new Date(end.getTime() - 1), timeZone, handoverHour);
}

export function buildCompletedDailyMemoryBuckets(options: {
  messages: DailyMemorySourceMessage[];
  now?: Date;
  timeZone?: string;
  handoverHour: number;
}): DailyMemoryBucket[] {
  const validMessages = options.messages
    .filter(
      (message) => typeof message.createdAt === "string" && Number.isFinite(new Date(message.createdAt).getTime()),
    )
    .sort((a, b) => new Date(a.createdAt!).getTime() - new Date(b.createdAt!).getTime());
  if (validMessages.length === 0) return [];

  const latestEnd = latestCompletedDailyMemoryHandover(
    options.now ?? new Date(),
    options.timeZone,
    options.handoverHour,
  );
  const earliest = new Date(validMessages[0]!.createdAt!).getTime();
  const bucketCount = Math.max(0, Math.ceil((latestEnd.getTime() - earliest) / DAY_MS));
  const buckets: DailyMemoryBucket[] = [];
  for (let offset = bucketCount - 1; offset >= 0; offset -= 1) {
    const end = new Date(latestEnd.getTime() - offset * DAY_MS);
    const start = new Date(end.getTime() - DAY_MS);
    const messages = validMessages.filter((message) => {
      const timestamp = new Date(message.createdAt!).getTime();
      return timestamp >= start.getTime() && timestamp < end.getTime();
    });
    if (messages.length === 0) continue;
    buckets.push({
      date: completedWindowDate(end, options.timeZone, options.handoverHour),
      start,
      end,
      messages,
    });
  }
  return buckets;
}

function cleanJsonishResponse(raw: string): string {
  const trimmed = raw.trim();
  const fence = trimmed.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/u);
  if (fence) return fence[1]!.trim();
  const first = trimmed.indexOf("{");
  const last = trimmed.lastIndexOf("}");
  return first >= 0 && last > first ? trimmed.slice(first, last + 1) : trimmed;
}

export function parseDailyMemoryFormationResponse(raw: string): DailyMemoryDraft[] {
  const parsed = JSON.parse(cleanJsonishResponse(raw)) as { memories?: unknown };
  if (!Array.isArray(parsed.memories)) throw new Error("Daily memory response must contain a memories array");
  const output: DailyMemoryDraft[] = [];
  for (const entry of parsed.memories) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    const record = entry as Record<string, unknown>;
    const memory = typeof record.memory === "string" ? record.memory.trim() : "";
    const importance = Number(record.importance);
    if (!memory || !Number.isInteger(importance) || importance < 1 || importance > 5) continue;
    output.push({ memory, importance });
  }
  return output.slice(0, 10);
}

function chunkTranscript(lines: string[]): string[] {
  const chunks: string[] = [];
  let current = "";
  for (const line of lines) {
    const next = current ? `${current}\n${line}` : line;
    if (current && next.length > TRANSCRIPT_CHUNK_CHARS) {
      chunks.push(current);
      current = line;
    } else {
      current = next;
    }
  }
  if (current) chunks.push(current);
  return chunks.slice(0, MAX_TRANSCRIPT_CHUNKS);
}

function withTimeout<T>(promise: Promise<T>, ms = FORMATION_TIMEOUT_MS): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error("Daily memory formation timeout")), ms)),
  ]);
}

async function callFormationModel(
  provider: BaseLLMProvider,
  model: string,
  prompt: string,
  content: string,
): Promise<DailyMemoryDraft[]> {
  const result = await withTimeout(
    provider.chatComplete(
      [
        { role: "system", content: prompt },
        { role: "user", content },
      ],
      { model, temperature: 0.2, maxTokens: 4096 },
    ),
  );
  return parseDailyMemoryFormationResponse(result.content ?? "");
}

export async function formDailyMemories(options: {
  provider: BaseLLMProvider;
  model: string;
  prompt?: string | null;
  bucket: DailyMemoryBucket;
  personaName: string;
  characterNames: Map<string, string>;
}): Promise<DailyMemoryDraft[]> {
  const lines = options.bucket.messages.map((message) => {
    const author =
      message.role === "user"
        ? options.personaName
        : message.role === "narrator" || message.role === "system"
          ? "Narrator"
          : ((message.characterId && options.characterNames.get(message.characterId)) ?? "Character");
    return `${author}: ${stripConversationPromptTimestamps((message.content ?? "").trim())}`;
  });
  const chunks = chunkTranscript(lines);
  if (chunks.length === 0) return [];
  const prompt = options.prompt?.trim() || DEFAULT_DAILY_MEMORY_PROMPT;
  if (chunks.length === 1) return callFormationModel(options.provider, options.model, prompt, chunks[0]!);

  const candidates: DailyMemoryDraft[] = [];
  for (let index = 0; index < chunks.length; index += 1) {
    candidates.push(
      ...(await callFormationModel(
        options.provider,
        options.model,
        `${prompt}\n\nThis is part ${index + 1} of ${chunks.length}; extract candidates from this part only.`,
        chunks[index]!,
      )),
    );
  }
  if (candidates.length <= 10) return candidates;
  return callFormationModel(
    options.provider,
    options.model,
    `${prompt}\n\nConsolidate the candidate memories below. Remove duplicates and return the best final set.`,
    JSON.stringify({ memories: candidates }),
  );
}

function toDailyMemory(row: typeof dailyMemories.$inferSelect): DailyMemory {
  return {
    id: row.id,
    chatId: row.chatId,
    date: row.date,
    memory: row.content,
    importance: row.importance,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

async function embedDrafts(
  drafts: DailyMemoryDraft[],
  embeddingSource: MemoryRecallEmbeddingSource | null,
  signal?: AbortSignal,
): Promise<Array<number[] | null>> {
  if (drafts.length === 0) return [];
  const embeddings = await embedMemoryRecallTexts(
    drafts.map((draft) => draft.memory),
    { embeddingSource, signal },
  );
  return drafts.map((_, index) => embeddings[index] ?? null);
}

export async function replaceDailyMemoryDay(options: {
  db: DB;
  chatId: string;
  date: string;
  memories: DailyMemoryDraft[];
  embeddingSource: MemoryRecallEmbeddingSource | null;
  signal?: AbortSignal;
}): Promise<DailyMemory[]> {
  const drafts = options.memories
    .map((draft) => ({
      id: typeof draft.id === "string" && draft.id.trim() ? draft.id : undefined,
      memory: typeof draft.memory === "string" ? draft.memory.trim() : "",
      importance: Math.floor(Number(draft.importance)),
    }))
    .filter((draft) => draft.memory && draft.importance >= 1 && draft.importance <= 5);
  const embeddings = await embedDrafts(drafts, options.embeddingSource, options.signal);
  const timestamp = nowIso();
  await options.db.transaction(async (tx) => {
    await tx
      .delete(dailyMemories)
      .where(and(eq(dailyMemories.chatId, options.chatId), eq(dailyMemories.date, options.date)));
    const existingDay = await tx
      .select()
      .from(dailyMemoryDays)
      .where(and(eq(dailyMemoryDays.chatId, options.chatId), eq(dailyMemoryDays.date, options.date)))
      .limit(1);
    if (existingDay[0]) {
      await tx.update(dailyMemoryDays).set({ updatedAt: timestamp }).where(eq(dailyMemoryDays.id, existingDay[0].id));
    } else {
      await tx.insert(dailyMemoryDays).values({
        id: newId(),
        chatId: options.chatId,
        date: options.date,
        formedAt: timestamp,
        updatedAt: timestamp,
      });
    }
    if (drafts.length > 0) {
      await tx.insert(dailyMemories).values(
        drafts.map((draft, index) => ({
          id: draft.id ?? newId(),
          chatId: options.chatId,
          date: options.date,
          content: draft.memory,
          importance: draft.importance,
          embedding: embeddings[index] ? JSON.stringify(embeddings[index]) : null,
          createdAt: timestamp,
          updatedAt: timestamp,
        })),
      );
    }
  });
  const result = await listDailyMemoriesForDate(options.db, options.chatId, options.date);
  emitDailyMemoryDayReplaced(options.chatId, options.date);
  return result;
}

export async function listDailyMemoriesForDate(db: DB, chatId: string, date: string): Promise<DailyMemory[]> {
  const rows = await db
    .select()
    .from(dailyMemories)
    .where(and(eq(dailyMemories.chatId, chatId), eq(dailyMemories.date, date)))
    .orderBy(dailyMemories.createdAt);
  return rows.map(toDailyMemory);
}

export async function listDailyMemoryDays(options: {
  db: DB;
  chatId: string;
  buckets: DailyMemoryBucket[];
}): Promise<DailyMemoryDay[]> {
  const [dayRows, memoryRows] = await Promise.all([
    options.db.select().from(dailyMemoryDays).where(eq(dailyMemoryDays.chatId, options.chatId)),
    options.db.select().from(dailyMemories).where(eq(dailyMemories.chatId, options.chatId)),
  ]);
  const daysByDate = new Map(dayRows.map((row) => [row.date, row]));
  const memoriesByDate = new Map<string, DailyMemory[]>();
  for (const row of memoryRows) {
    const list = memoriesByDate.get(row.date) ?? [];
    list.push(toDailyMemory(row));
    memoriesByDate.set(row.date, list);
  }
  const dates = new Set([
    ...options.buckets.map((bucket) => bucket.date),
    ...daysByDate.keys(),
    ...memoriesByDate.keys(),
  ]);
  return [...dates]
    .sort((a, b) => dateKeyTime(a) - dateKeyTime(b))
    .map((date) => ({
      date,
      formed: daysByDate.has(date),
      formedAt: daysByDate.get(date)?.formedAt ?? null,
      memories: memoriesByDate.get(date) ?? [],
    }));
}

function dateKeyTime(value: string): number {
  const [day, month, year] = value.split(".").map(Number);
  return Date.UTC(year ?? 0, (month ?? 1) - 1, day ?? 1);
}

export async function generateAndReplaceDailyMemoryDay(options: {
  db: DB;
  chatId: string;
  bucket: DailyMemoryBucket;
  provider: BaseLLMProvider;
  model: string;
  prompt?: string | null;
  personaName: string;
  characterNames: Map<string, string>;
  embeddingSource: MemoryRecallEmbeddingSource | null;
  signal?: AbortSignal;
}): Promise<DailyMemory[]> {
  const formed = await formDailyMemories(options);
  return replaceDailyMemoryDay({
    db: options.db,
    chatId: options.chatId,
    date: options.bucket.date,
    memories: formed,
    embeddingSource: options.embeddingSource,
    signal: options.signal,
  });
}

function parseEmbedding(value: string | null): number[] | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) && parsed.every((item) => typeof item === "number" && Number.isFinite(item))
      ? parsed
      : null;
  } catch {
    return null;
  }
}

function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length === 0 || a.length !== b.length) return 0;
  let dot = 0;
  let aMag = 0;
  let bMag = 0;
  for (let index = 0; index < a.length; index += 1) {
    dot += a[index]! * b[index]!;
    aMag += a[index]! ** 2;
    bMag += b[index]! ** 2;
  }
  const denominator = Math.sqrt(aMag) * Math.sqrt(bMag);
  return denominator > 0 ? dot / denominator : 0;
}

export interface RankedDailyMemory extends DailyMemory {
  semanticScore: number;
  recencyScore: number;
  rankingScore: number;
}

export const LAST_DAILY_MEMORY_RETRIEVAL_METADATA_KEY = "lastDailyMemoryRetrieval";

export interface DailyMemoryRetrievalSnapshot {
  queriedAt: string;
  memories: Array<Pick<DailyMemory, "id" | "date" | "memory" | "importance">>;
}

export function createDailyMemoryRetrievalSnapshot(
  memories: RankedDailyMemory[],
  queriedAt: Date = new Date(),
): DailyMemoryRetrievalSnapshot {
  return {
    queriedAt: queriedAt.toISOString(),
    memories: memories.map(({ id, date, memory, importance }) => ({ id, date, memory, importance })),
  };
}

export function normalizeDailyMemoryRetrievalSnapshot(value: unknown): DailyMemoryRetrievalSnapshot | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (typeof record.queriedAt !== "string" || !Number.isFinite(Date.parse(record.queriedAt))) return null;
  if (!Array.isArray(record.memories)) return null;
  const memories = record.memories.flatMap((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return [];
    const memory = entry as Record<string, unknown>;
    const importance = Number(memory.importance);
    if (
      typeof memory.id !== "string" ||
      !memory.id.trim() ||
      typeof memory.date !== "string" ||
      !memory.date.trim() ||
      typeof memory.memory !== "string" ||
      !memory.memory.trim() ||
      !Number.isInteger(importance) ||
      importance < 1 ||
      importance > 5
    ) {
      return [];
    }
    return [{ id: memory.id, date: memory.date, memory: memory.memory, importance }];
  });
  return { queriedAt: new Date(record.queriedAt).toISOString(), memories };
}

export function buildDailyMemoryRetrievalQuery(
  messages: DailyMemorySourceMessage[],
  retrievalMessageCount: number,
): string[] {
  return messages
    .filter((message) => message.role === "user" || message.role === "assistant" || message.role === "narrator")
    .slice(-retrievalMessageCount)
    .map((message) => `${message.role}: ${String(message.content ?? "").trim()}`)
    .filter((line) => line.trim().length > 0);
}

export async function retrieveDailyMemories(options: {
  db: DB;
  chatId: string;
  query: string;
  settings: DailyMemorySettings;
  embeddingSource: MemoryRecallEmbeddingSource | null;
  now?: Date;
  signal?: AbortSignal;
}): Promise<RankedDailyMemory[]> {
  const queryEmbeddings = await embedMemoryRecallTexts([options.query], {
    embeddingSource: options.embeddingSource,
    signal: options.signal,
  });
  const queryEmbedding = queryEmbeddings[0];
  if (!queryEmbedding?.length) return [];
  const rows = await options.db
    .select()
    .from(dailyMemories)
    .where(and(eq(dailyMemories.chatId, options.chatId), isNotNull(dailyMemories.embedding)));
  const totalWeight =
    options.settings.semanticWeight + options.settings.importanceWeight + options.settings.recencyWeight || 1;
  const nowMs = (options.now ?? new Date()).getTime();
  return rows
    .map((row): RankedDailyMemory | null => {
      const embedding = parseEmbedding(row.embedding);
      if (!embedding || embedding.length !== queryEmbedding.length) return null;
      const semanticScore = Math.max(0, Math.min(1, cosineSimilarity(queryEmbedding, embedding)));
      const importanceScore = (row.importance - 1) / 4;
      const ageDays = Math.max(0, (nowMs - dateKeyTime(row.date)) / DAY_MS);
      const recencyScore = 2 ** (-ageDays / options.settings.recencyHalfLifeDays);
      const rankingScore =
        (semanticScore * options.settings.semanticWeight +
          importanceScore * options.settings.importanceWeight +
          recencyScore * options.settings.recencyWeight) /
        totalWeight;
      return { ...toDailyMemory(row), semanticScore, recencyScore, rankingScore };
    })
    .filter((memory): memory is RankedDailyMemory => memory !== null)
    .filter((memory) => memory.rankingScore >= options.settings.minimumRank / 100)
    .sort(
      (a, b) =>
        b.rankingScore - a.rankingScore || b.importance - a.importance || dateKeyTime(b.date) - dateKeyTime(a.date),
    );
}

export function buildDailyMemoriesContextBlock(memories: RankedDailyMemory[], wrapFormat: WrapFormat): string {
  const grouped = new Map<string, RankedDailyMemory[]>();
  for (const memory of memories) {
    const list = grouped.get(memory.date) ?? [];
    list.push(memory);
    grouped.set(memory.date, list);
  }
  const lines = [
    "The following are relevant durable memories from completed days in this conversation. Use them for continuity without mentioning memory retrieval unless natural.",
  ];
  for (const date of [...grouped.keys()].sort((a, b) => dateKeyTime(a) - dateKeyTime(b))) {
    lines.push(`\n[${date}]`);
    for (const memory of grouped.get(date) ?? []) {
      lines.push(`- (importance ${memory.importance}/5) ${sanitizePromptLeaf(memory.memory, wrapFormat)}`);
    }
  }
  return wrapContent(lines.join("\n"), "Daily Conversation Memories", wrapFormat);
}

export async function ensureMissingDailyMemoryDays(options: {
  db: DB;
  chatId: string;
  buckets: DailyMemoryBucket[];
  maxDays: number;
  provider: BaseLLMProvider;
  model: string;
  prompt?: string | null;
  personaName: string;
  characterNames: Map<string, string>;
  embeddingSource: MemoryRecallEmbeddingSource | null;
  signal?: AbortSignal;
}): Promise<string[]> {
  const formedRows = await options.db.select().from(dailyMemoryDays).where(eq(dailyMemoryDays.chatId, options.chatId));
  const formedDates = new Set(formedRows.map((row) => row.date));
  const missing = options.buckets
    .filter((bucket) => !formedDates.has(bucket.date))
    .slice(0, Math.max(0, options.maxDays));
  const generated: string[] = [];
  for (const bucket of missing) {
    try {
      await generateAndReplaceDailyMemoryDay({ ...options, bucket });
      generated.push(bucket.date);
    } catch (error) {
      logger.warn(error, "[daily-memory] Formation failed for chat %s day %s", options.chatId, bucket.date);
    }
  }
  return generated;
}
