import type {
  CharacterData,
  CharacterMindBuildOrSyncResult,
  CharacterMindCancelResult,
  CharacterMindIngestResult,
  CharacterMindLintResult,
  CharacterMindOperationName,
  CharacterMindQueryResult,
  CharacterMindStatus,
  DailyMemoryDay,
} from "@marinara-engine/shared";
import type { DB } from "../../db/connection.js";
import { logger } from "../../lib/logger.js";
import { listDailyMemoryDays } from "../conversation/daily-memory.service.js";
import { createCharactersStorage } from "../storage/characters.storage.js";
import { createChatsStorage } from "../storage/chats.storage.js";
import { CHARACTER_MIND_OPERATION_TIMEOUT_MS } from "./character-mind.constants.js";
import {
  initializeMind,
  listMarkdown,
  mindDiskPath,
  mindRoot,
  pathExists,
  revisionForPayload,
  snapshotCharacterCard,
  snapshotDailyMemories,
  verifyRawMarkdown,
  type CharacterCardRawPayload,
  type DailyMemoryRawPayload,
} from "./character-mind.files.js";
import {
  appendMindLog,
  ingestsSinceLastLint,
  parseMindLog,
  queryLogSubject,
  readMindLog,
  successfulIngestRevisions,
} from "./character-mind.log.js";
import {
  createCharacterMindTrace,
  deterministicMindFindings,
  validateCompleteWiki,
  type CharacterMindTrace,
} from "./character-mind.tools.js";
import {
  isCharacterMindAgentEnabled,
  resolveCharacterMindRuntime,
  runCharacterMindOperation,
} from "./character-mind.runtime.js";

export class CharacterMindError extends Error {
  constructor(
    message: string,
    public readonly statusCode: 400 | 404 | 409 | 422 | 500,
  ) {
    super(message);
  }
}

interface MindContext {
  chat: any;
  metadata: Record<string, unknown>;
  character: any;
  root: string;
}

interface ActiveOperation {
  name: CharacterMindOperationName;
  startedAt: string;
  controller: AbortController;
  done: Promise<void>;
  release: () => void;
}

const activeOperations = new Map<string, ActiveOperation>();

function parseRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed;
    } catch {
      return {};
    }
  }
  return {};
}

function parseIds(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === "string");
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
    } catch {
      return [];
    }
  }
  return [];
}

function key(chatId: string, characterId: string): string {
  return `${chatId}\0${characterId}`;
}

async function loadContext(db: DB, chatId: string, characterId: string): Promise<MindContext> {
  const chats = createChatsStorage(db);
  const characters = createCharactersStorage(db);
  const chat = await chats.getById(chatId);
  if (!chat || chat.mode !== "conversation" || !parseIds(chat.characterIds).includes(characterId)) {
    throw new CharacterMindError("Conversation character not found", 404);
  }
  const character = await characters.getById(characterId);
  if (!character) throw new CharacterMindError("Conversation character not found", 404);
  return { chat, character, metadata: parseRecord(chat.metadata), root: mindRoot(chatId, characterId) };
}

function cardPayload(context: MindContext): CharacterCardRawPayload {
  const overrides = parseRecord(context.metadata.conversationAboutMeOverrides);
  return {
    characterId: context.character.id,
    chatId: context.chat.id,
    data: JSON.parse(context.character.data) as CharacterData,
    conversationOverrides: {
      aboutMe: typeof overrides[context.character.id] === "string" ? (overrides[context.character.id] as string) : null,
    },
  };
}

function memoryPayload(chatId: string, day: DailyMemoryDay): DailyMemoryRawPayload {
  return {
    chatId,
    date: day.date,
    memories: [...day.memories]
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id))
      .map(({ id, memory, importance, createdAt, updatedAt }) => ({ id, memory, importance, createdAt, updatedAt })),
  };
}

async function formedDays(db: DB, chatId: string): Promise<DailyMemoryDay[]> {
  return (await listDailyMemoryDays({ db, chatId, buckets: [] })).filter((day) => day.formed);
}

async function currentRevisions(db: DB, context: MindContext): Promise<string[]> {
  const revisions = [revisionForPayload(cardPayload(context))];
  for (const day of await formedDays(db, context.chat.id))
    revisions.push(revisionForPayload(memoryPayload(context.chat.id, day)));
  return revisions;
}

async function pendingSources(root: string): Promise<string[]> {
  if (!(await pathExists(root))) return [];
  const successful = successfulIngestRevisions(parseMindLog(await readMindLog(root)));
  const sources = (await listMarkdown(root, "raw")).filter((path) => path.startsWith("raw/"));
  const pending: Array<{ path: string; revision: string; sourceKey: string }> = [];
  for (const path of sources) {
    const verified = await verifyRawMarkdown(root, path);
    if (!successful.has(verified.revision)) pending.push({ path, ...verified });
  }
  const dateValue = (sourceKey: string) => {
    const date = sourceKey.split(":").at(-1) ?? "";
    const dot = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(date);
    return dot ? `${dot[3]}-${dot[2]}-${dot[1]}` : date;
  };
  return pending
    .sort((a, b) => {
      const aCard = a.path.startsWith("raw/character-card/");
      const bCard = b.path.startsWith("raw/character-card/");
      if (aCard !== bCard) return aCard ? -1 : 1;
      return aCard
        ? a.path.localeCompare(b.path)
        : dateValue(a.sourceKey).localeCompare(dateValue(b.sourceKey)) || a.path.localeCompare(b.path);
    })
    .map((item) => item.path);
}

async function snapshotInputs(db: DB, context: MindContext) {
  const snapshots = [await snapshotCharacterCard(context.root, cardPayload(context))];
  for (const day of await formedDays(db, context.chat.id))
    snapshots.push(await snapshotDailyMemories(context.root, memoryPayload(context.chat.id, day)));
  return snapshots;
}

function claimOperation(chatId: string, characterId: string, name: CharacterMindOperationName): ActiveOperation {
  const operationKey = key(chatId, characterId);
  if (activeOperations.has(operationKey))
    throw new CharacterMindError("A Character Mind operation is already active", 409);
  let release: () => void = () => undefined;
  const done = new Promise<void>((resolve) => {
    release = resolve;
  });
  const operation: ActiveOperation = {
    name,
    startedAt: new Date().toISOString(),
    controller: new AbortController(),
    done,
    release,
  };
  activeOperations.set(operationKey, operation);
  return operation;
}

function finishOperation(chatId: string, characterId: string, operation: ActiveOperation) {
  if (activeOperations.get(key(chatId, characterId)) === operation) activeOperations.delete(key(chatId, characterId));
  operation.release();
}

async function operationSignal(operation: ActiveOperation): Promise<AbortSignal> {
  return AbortSignal.any([operation.controller.signal, AbortSignal.timeout(CHARACTER_MIND_OPERATION_TIMEOUT_MS)]);
}

async function requireRuntime(db: DB, context: MindContext) {
  const runtime = await resolveCharacterMindRuntime(db, {
    metadata: context.metadata,
    chatConnectionId: context.chat.connectionId,
  });
  if (!runtime) throw new CharacterMindError("Character Mind agent is not enabled or has no usable connection", 422);
  return runtime;
}

function traceFromError(error: unknown): CharacterMindTrace {
  const trace =
    error && typeof error === "object" ? (error as { characterMindTrace?: unknown }).characterMindTrace : null;
  return trace && typeof trace === "object" ? (trace as CharacterMindTrace) : createCharacterMindTrace();
}

async function ingestOne(
  db: DB,
  context: MindContext,
  source: string,
  operation: ActiveOperation,
): Promise<CharacterMindIngestResult> {
  const runtime = await requireRuntime(db, context);
  const { revision } = await verifyRawMarkdown(context.root, source);
  let trace;
  try {
    const run = await runCharacterMindOperation({
      root: context.root,
      operation: "ingest",
      value: source,
      runtime,
      signal: await operationSignal(operation),
    });
    trace = run.trace;
    await validateCompleteWiki(context.root);
    const result = run.result as CharacterMindIngestResult;
    await appendMindLog({
      root: context.root,
      operation: "ingest",
      subject: source,
      status: "success",
      revision,
      trace,
      summary: result.summary,
    });
    return result;
  } catch (error) {
    trace ??= traceFromError(error);
    await appendMindLog({
      root: context.root,
      operation: "ingest",
      subject: source,
      status: "failure",
      revision,
      trace,
      error: error instanceof Error ? error.message : "Ingest failed",
    });
    throw error;
  }
}

async function maybeQueueAutomaticLint(db: DB, chatId: string, characterId: string) {
  const context = await loadContext(db, chatId, characterId);
  if (ingestsSinceLastLint(parseMindLog(await readMindLog(context.root))) < 7) return;
  setTimeout(() => {
    void lintCharacterMind(db, chatId, characterId).catch((error) =>
      logger.warn(error, "Automatic Character Mind lint failed"),
    );
  }, 0);
}

export async function getCharacterMindStatus(
  db: DB,
  chatId: string,
  characterId: string,
): Promise<CharacterMindStatus> {
  const context = await loadContext(db, chatId, characterId);
  const initialized = await pathExists(context.root);
  const entries = initialized ? parseMindLog(await readMindLog(context.root)) : [];
  const last = entries.at(-1);
  const active = activeOperations.get(key(chatId, characterId));
  return {
    initialized,
    path: initialized ? await mindDiskPath(context.root) : null,
    currentRevisions: await currentRevisions(db, context),
    pendingSources: initialized ? await pendingSources(context.root) : [],
    activeOperation: active ? { name: active.name, startedAt: active.startedAt } : null,
    lastLogEntry: last ? { operation: last.operation, timestamp: last.timestamp, status: last.status } : null,
  };
}

async function buildOrSync(
  db: DB,
  chatId: string,
  characterId: string,
  mode: "build" | "sync",
  maxSources?: number,
): Promise<CharacterMindBuildOrSyncResult> {
  const context = await loadContext(db, chatId, characterId);
  await requireRuntime(db, context);
  const initialized = await pathExists(context.root);
  if (mode === "build" && initialized) throw new CharacterMindError("Character Mind already exists; use Sync", 409);
  if (mode === "sync" && !initialized)
    throw new CharacterMindError("Character Mind is not initialized; use Build", 409);
  const operation = claimOperation(chatId, characterId, mode);
  try {
    if (mode === "build") await initializeMind(context.root);
    const snapshots = await snapshotInputs(db, context);
    const processed: CharacterMindBuildOrSyncResult["processed"] = [];
    const pending = await pendingSources(context.root);
    const limit = maxSources === undefined ? pending.length : Math.max(1, Math.min(100, Math.floor(maxSources)));
    for (const source of pending.slice(0, limit)) {
      try {
        processed.push({ source, result: await ingestOne(db, context, source, operation), error: null });
      } catch {
        processed.push({ source, result: null, error: "Character Mind ingest failed; inspect log.md for details" });
        break;
      }
    }
    return {
      snapshotsCreated: snapshots.filter((snapshot) => snapshot.created).map((snapshot) => snapshot.path),
      processed,
      pendingSources: await pendingSources(context.root),
    };
  } finally {
    finishOperation(chatId, characterId, operation);
    if (await pathExists(context.root)) void maybeQueueAutomaticLint(db, chatId, characterId).catch(() => undefined);
  }
}

export function buildCharacterMind(db: DB, chatId: string, characterId: string) {
  return buildOrSync(db, chatId, characterId, "build");
}

export function syncCharacterMind(db: DB, chatId: string, characterId: string, maxSources?: number) {
  return buildOrSync(db, chatId, characterId, "sync", maxSources);
}

export async function queryCharacterMind(
  db: DB,
  chatId: string,
  characterId: string,
  query: string,
): Promise<CharacterMindQueryResult> {
  const context = await loadContext(db, chatId, characterId);
  if (!(await pathExists(context.root))) throw new CharacterMindError("Character Mind is not initialized", 409);
  const existing = activeOperations.get(key(chatId, characterId));
  if (existing && existing.name !== "query") await existing.done;
  const runtime = await requireRuntime(db, context);
  const operation = claimOperation(chatId, characterId, "query");
  try {
    const run = await runCharacterMindOperation({
      root: context.root,
      operation: "query",
      value: query,
      runtime,
      signal: await operationSignal(operation),
    });
    const result = run.result as CharacterMindQueryResult;
    await appendMindLog({
      root: context.root,
      operation: "query",
      subject: queryLogSubject(query),
      status: "success",
      trace: run.trace,
    });
    return result;
  } catch (error) {
    const trace = traceFromError(error);
    await appendMindLog({
      root: context.root,
      operation: "query",
      subject: queryLogSubject(query),
      status: "failure",
      trace,
      error: error instanceof Error ? error.message : "Query failed",
    });
    throw error;
  } finally {
    finishOperation(chatId, characterId, operation);
  }
}

export async function lintCharacterMind(db: DB, chatId: string, characterId: string): Promise<CharacterMindLintResult> {
  const context = await loadContext(db, chatId, characterId);
  if (!(await pathExists(context.root))) throw new CharacterMindError("Character Mind is not initialized", 409);
  const runtime = await requireRuntime(db, context);
  const operation = claimOperation(chatId, characterId, "lint");
  const findings = await deterministicMindFindings(context.root);
  try {
    const run = await runCharacterMindOperation({
      root: context.root,
      operation: "lint",
      value: findings.length ? findings.join("\n") : "No deterministic link or orphan findings.",
      runtime,
      signal: await operationSignal(operation),
    });
    await validateCompleteWiki(context.root);
    const result = run.result as CharacterMindLintResult;
    const allFindings = [...new Set([...findings, ...result.findings])];
    const output = { ...result, findings: allFindings };
    await appendMindLog({
      root: context.root,
      operation: "lint",
      subject: "wiki",
      status: "success",
      trace: run.trace,
      findings: allFindings,
      summary: result.summary,
    });
    return output;
  } catch (error) {
    const trace = traceFromError(error);
    await appendMindLog({
      root: context.root,
      operation: "lint",
      subject: "wiki",
      status: "failure",
      trace,
      findings,
      error: error instanceof Error ? error.message : "Lint failed",
    });
    throw error;
  } finally {
    finishOperation(chatId, characterId, operation);
  }
}

export function cancelCharacterMind(chatId: string, characterId: string): CharacterMindCancelResult {
  const operation = activeOperations.get(key(chatId, characterId));
  if (!operation) return { cancelled: false, operation: null };
  operation.controller.abort();
  return { cancelled: true, operation: operation.name };
}

export async function queueCharacterMindSyncAfterDailyMemory(db: DB, chatId: string): Promise<void> {
  const chats = createChatsStorage(db);
  const chat = await chats.getById(chatId);
  if (!chat || chat.mode !== "conversation") return;
  const metadata = parseRecord(chat.metadata);
  if (!isCharacterMindAgentEnabled(metadata)) return;
  for (const characterId of parseIds(chat.characterIds)) {
    if (!(await pathExists(mindRoot(chatId, characterId))) || activeOperations.has(key(chatId, characterId))) continue;
    void syncCharacterMind(db, chatId, characterId, 1).catch((error) =>
      logger.warn(error, "Automatic Character Mind sync failed"),
    );
  }
}
