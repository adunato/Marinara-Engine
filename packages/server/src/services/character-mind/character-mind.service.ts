import type {
  CharacterData,
  CharacterMindBuildOrSyncResult,
  CharacterMindCancelResult,
  CharacterMindIngestResult,
  CharacterMindLintResult,
  CharacterMindOperationName,
  CharacterMindPlanResult,
  CharacterMindQueryResult,
  CharacterMindStatus,
  DailyMemoryDay,
} from "@marinara-engine/shared";
import type { DB } from "../../db/connection.js";
import { logger } from "../../lib/logger.js";
import { listDailyMemoryDays } from "../conversation/daily-memory.service.js";
import { createCharactersStorage } from "../storage/characters.storage.js";
import { createChatsStorage } from "../storage/chats.storage.js";
import {
  initializeMind,
  listMarkdown,
  mindDiskPath,
  mindRoot,
  pathExists,
  readMindIndex,
  resolveMindMarkdown,
  revisionForPayload,
  resetMindSynthesis,
  snapshotAutoSummary,
  snapshotCharacterCard,
  snapshotDailyMemories,
  verifyRawMarkdown,
  writeMindIndex,
  type AutoSummaryRawPayload,
  type CharacterCardRawPayload,
  type DailyMemoryRawPayload,
} from "./character-mind.files.js";
import {
  appendMindLog,
  hasSuccessfulBuild,
  ingestsSinceLastLint,
  parseMindLog,
  queryLogSubject,
  readMindLog,
  successfulBuildPagesSinceLatestMap,
  successfulIngestRevisions,
} from "./character-mind.log.js";
import {
  characterMindPlanMatchesSources,
  pendingCharacterMindPages,
  parseCharacterMindPlan,
  renderCharacterMindPlan,
  type CharacterMindChangePlan,
} from "./character-mind.plan.js";
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
  type CharacterMindMarkdownResult,
  type CharacterMindOperationDiagnostics,
} from "./character-mind.runtime.js";
import { CharacterMindCandidateSet } from "./character-mind.candidate.js";

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

function autoSummaryPayloads(context: MindContext): AutoSummaryRawPayload[] {
  const payloads: AutoSummaryRawPayload[] = [];
  const add = (period: "day" | "week", values: unknown) => {
    const entries = parseRecord(values);
    for (const date of Object.keys(entries).sort()) {
      const entry = parseRecord(entries[date]);
      const summary = typeof entry.summary === "string" ? entry.summary.trim() : "";
      const keyDetails = Array.isArray(entry.keyDetails)
        ? entry.keyDetails
            .filter((item): item is string => typeof item === "string" && !!item.trim())
            .map((item) => item.trim())
        : [];
      if (!summary && keyDetails.length === 0) continue;
      payloads.push({ chatId: context.chat.id, period, date, summary, keyDetails });
    }
  };
  add("day", context.metadata.daySummaries);
  add("week", context.metadata.weekSummaries);
  return payloads;
}

async function formedDays(db: DB, chatId: string): Promise<DailyMemoryDay[]> {
  return (await listDailyMemoryDays({ db, chatId, buckets: [] })).filter((day) => day.formed);
}

async function currentRevisions(db: DB, context: MindContext): Promise<string[]> {
  const revisions = [revisionForPayload(cardPayload(context))];
  for (const summary of autoSummaryPayloads(context)) revisions.push(revisionForPayload(summary));
  for (const day of await formedDays(db, context.chat.id))
    revisions.push(revisionForPayload(memoryPayload(context.chat.id, day)));
  return revisions;
}

async function pendingSources(root: string, current?: Set<string>): Promise<string[]> {
  if (!(await pathExists(root))) return [];
  const successful = successfulIngestRevisions(parseMindLog(await readMindLog(root)));
  const sources = (await listMarkdown(root, "raw")).filter((path) => path.startsWith("raw/"));
  const pending: Array<{ path: string; revision: string; sourceKey: string }> = [];
  for (const path of sources) {
    const verified = await verifyRawMarkdown(root, path);
    if (current && !current.has(verified.revision)) continue;
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
      return dateValue(a.sourceKey).localeCompare(dateValue(b.sourceKey)) || a.path.localeCompare(b.path);
    })
    .map((item) => item.path);
}

async function snapshotInputs(db: DB, context: MindContext) {
  const snapshots = [await snapshotCharacterCard(context.root, cardPayload(context))];
  for (const summary of autoSummaryPayloads(context)) snapshots.push(await snapshotAutoSummary(context.root, summary));
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
  return operation.controller.signal;
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

function diagnosticsFromError(error: unknown): CharacterMindOperationDiagnostics {
  const diagnostics =
    error && typeof error === "object"
      ? (error as { characterMindDiagnostics?: unknown }).characterMindDiagnostics
      : null;
  if (!diagnostics || typeof diagnostics !== "object") return { validationAttempts: 0, validationFindings: [] };
  const value = diagnostics as Partial<CharacterMindOperationDiagnostics>;
  return {
    validationAttempts: Number.isFinite(value.validationAttempts) ? Number(value.validationAttempts) : 0,
    validationFindings: Array.isArray(value.validationFindings)
      ? value.validationFindings.filter((finding): finding is string => typeof finding === "string")
      : [],
  };
}

function providerErrorFromError(error: unknown): string | undefined {
  const value =
    error && typeof error === "object"
      ? (error as { characterMindProviderError?: unknown }).characterMindProviderError
      : undefined;
  return typeof value === "string" && value.trim() ? value : undefined;
}

function mergeMindTrace(target: CharacterMindTrace, source: CharacterMindTrace): void {
  target.listed.push(...source.listed);
  target.searched.push(...source.searched);
  for (const field of ["read", "verifiedRaw", "created", "updated", "moved", "deleted"] as const) {
    for (const value of source[field]) target[field].add(value);
  }
}

function pageMaterializationInput(
  plan: CharacterMindPlanResult,
  page: CharacterMindPlanResult["pages"][number],
): string {
  return JSON.stringify({
    targetPage: page,
    pageMap: plan.pages.map(({ path, title, purpose }) => ({ path, title, purpose })),
    allowedRawSources: page.sources,
  });
}

async function buildCorpus(
  context: MindContext,
  runtime: Awaited<ReturnType<typeof requireRuntime>>,
  operation: ActiveOperation,
  snapshots: Awaited<ReturnType<typeof snapshotInputs>>,
  restart: boolean,
): Promise<CharacterMindIngestResult> {
  const sourcePaths = snapshots.map((snapshot) => snapshot.path);
  let planTrace = createCharacterMindTrace();
  let plan: CharacterMindPlanResult | null = null;
  if (!restart) {
    try {
      const persisted = parseCharacterMindPlan(await readMindIndex(context.root));
      if (persisted && characterMindPlanMatchesSources(persisted, sourcePaths)) plan = persisted;
    } catch {
      // An absent or manually damaged checkpoint is rebuilt from the current corpus.
    }
  }
  const resumed = plan !== null;
  if (!plan) {
    await resetMindSynthesis(context.root);
    try {
      const run = await runCharacterMindOperation({
        root: context.root,
        operation: "plan",
        value: JSON.stringify(sourcePaths),
        sourcePaths,
        runtime,
        signal: await operationSignal(operation),
      });
      planTrace = run.trace;
      plan = run.result as CharacterMindPlanResult;
      await writeMindIndex(context.root, renderCharacterMindPlan(plan));
      await appendMindLog({
        root: context.root,
        operation: "build-map",
        subject: `${sourcePaths.length} current sources`,
        status: "success",
        trace: planTrace,
        summary: plan.summary,
        validationAttempts: run.diagnostics.validationAttempts,
        validationFindings: run.diagnostics.validationFindings,
      });
    } catch (error) {
      planTrace = traceFromError(error);
      const diagnostics = diagnosticsFromError(error);
      await appendMindLog({
        root: context.root,
        operation: "build-map",
        subject: `${sourcePaths.length} current sources`,
        status: "failure",
        trace: planTrace,
        validationAttempts: diagnostics.validationAttempts,
        validationFindings: diagnostics.validationFindings,
        providerError: providerErrorFromError(error),
        error: error instanceof Error ? error.message : "Build map failed",
      });
      throw error;
    }
  }

  const buildTrace = createCharacterMindTrace();
  const pageSummaries: string[] = [];
  const completedPages = resumed
    ? successfulBuildPagesSinceLatestMap(parseMindLog(await readMindLog(context.root)))
    : new Set<string>();
  const existingPages = new Set((await listMarkdown(context.root, "wiki")).filter((path) => path.startsWith("wiki/")));
  const pendingPages = pendingCharacterMindPages(plan, completedPages, existingPages);
  const preservedPages = plan.pages.length - pendingPages.length;
  for (const page of pendingPages) {
    let pageTrace = createCharacterMindTrace();
    const candidates = await CharacterMindCandidateSet.create(context.root);
    try {
      if (await pathExists((await resolveMindMarkdown(context.root, page.path)).path))
        await candidates.requireExisting(page.path);
      else await candidates.requireAbsent(page.path);
      const run = await runCharacterMindOperation({
        root: context.root,
        operation: "build-page",
        value: pageMaterializationInput(plan, page),
        plan,
        page,
        candidate: candidates,
        runtime,
        signal: await operationSignal(operation),
      });
      pageTrace = run.trace;
      await candidates.write(page.path, (run.result as CharacterMindMarkdownResult).content);
      await candidates.publish(pageTrace);
      mergeMindTrace(buildTrace, pageTrace);
      const result = run.result as CharacterMindMarkdownResult;
      pageSummaries.push(result.summary);
      await appendMindLog({
        root: context.root,
        operation: "build-page",
        subject: page.path,
        status: "success",
        trace: pageTrace,
        summary: result.summary,
        validationAttempts: run.diagnostics.validationAttempts,
        validationFindings: run.diagnostics.validationFindings,
      });
    } catch (error) {
      pageTrace = traceFromError(error);
      const diagnostics = diagnosticsFromError(error);
      mergeMindTrace(buildTrace, pageTrace);
      const message = error instanceof Error ? error.message : "Page materialization failed";
      await appendMindLog({
        root: context.root,
        operation: "build-page",
        subject: page.path,
        status: "failure",
        trace: pageTrace,
        validationAttempts: diagnostics.validationAttempts,
        validationFindings: diagnostics.validationFindings,
        providerError: providerErrorFromError(error),
        error: message,
      });
      await appendMindLog({
        root: context.root,
        operation: "build",
        subject: `${plan.pages.length} mapped pages`,
        status: "failure",
        trace: buildTrace,
        error: `${page.path}: ${message}`,
      });
      throw error;
    } finally {
      await candidates.dispose();
    }
  }

  try {
    await writeMindIndex(context.root, renderCharacterMindPlan(plan));
    buildTrace.updated.add("index.md");
    await validateCompleteWiki(context.root);
  } catch (error) {
    await appendMindLog({
      root: context.root,
      operation: "build",
      subject: `${plan.pages.length} mapped pages`,
      status: "failure",
      trace: buildTrace,
      error: error instanceof Error ? error.message : "Build finalization failed",
    });
    throw error;
  }
  const result: CharacterMindIngestResult = {
    summary: `${resumed ? "Resumed" : "Materialized"} ${plan.pages.length} mapped page${plan.pages.length === 1 ? "" : "s"}${preservedPages ? `, preserving ${preservedPages} completed page${preservedPages === 1 ? "" : "s"}` : ""}. ${pageSummaries.join(" ")}`,
    created: [...buildTrace.created],
    updated: [...buildTrace.updated],
  };
  await appendMindLog({
    root: context.root,
    operation: "build",
    subject: `${plan.pages.length} mapped pages`,
    status: "success",
    revisions: snapshots.map((snapshot) => snapshot.revision),
    trace: buildTrace,
    summary: result.summary,
  });
  return result;
}

async function executeCharacterMindChangePlan(input: {
  context: MindContext;
  runtime: Awaited<ReturnType<typeof requireRuntime>>;
  operation: ActiveOperation;
  plan: CharacterMindChangePlan;
  discoveryTrace: CharacterMindTrace;
}): Promise<{ trace: CharacterMindTrace; summaries: string[] }> {
  const candidates = await CharacterMindCandidateSet.create(input.context.root);
  const trace = createCharacterMindTrace();
  mergeMindTrace(trace, input.discoveryTrace);
  const summaries: string[] = [];
  try {
    for (const action of input.plan.actions) {
      if (action.type === "create") await candidates.requireAbsent(action.path);
      else if (action.type === "rename") {
        await candidates.requireExisting(action.from);
        await candidates.requireAbsent(action.to);
      } else await candidates.requireExisting(action.path);
    }

    for (const action of input.plan.actions) {
      if (action.type === "rename") await candidates.move(action.from, action.to);
      if (action.type === "delete") await candidates.delete(action.path);
    }

    const liveWikiPaths = (await listMarkdown(input.context.root, "wiki")).filter((path) => path.startsWith("wiki/"));
    const knownWikiPaths = [
      ...new Set([
        ...liveWikiPaths.filter(
          (path) =>
            !input.plan.actions.some(
              (action) =>
                (action.type === "delete" && action.path === path) ||
                (action.type === "rename" && action.from === path),
            ),
        ),
        ...input.plan.actions.flatMap((action) =>
          action.type === "create" ? [action.path] : action.type === "rename" ? [action.to] : [],
        ),
      ]),
    ];

    for (const action of input.plan.actions) {
      if (action.type === "rename" || action.type === "delete") continue;
      if (action.type === "create" || action.type === "replace") {
        const run = await runCharacterMindOperation({
          root: input.context.root,
          operation: "write-page",
          value: JSON.stringify({ action, changePlan: input.plan.actions }),
          target: { path: action.path, sources: action.sources, mustRead: action.type === "replace" },
          knownWikiPaths,
          runtime: input.runtime,
          signal: await operationSignal(input.operation),
        });
        mergeMindTrace(trace, run.trace);
        const result = run.result as CharacterMindMarkdownResult;
        await candidates.write(action.path, result.content);
        summaries.push(result.summary);
        continue;
      }
      if (action.type === "edit" || action.type === "index-edit") {
        const sources = action.type === "edit" ? action.sources : [];
        const run = await runCharacterMindOperation({
          root: input.context.root,
          operation: "edit",
          value: JSON.stringify({ action, changePlan: input.plan.actions }),
          target: { path: action.path, sources, mustRead: true },
          candidate: candidates,
          runtime: input.runtime,
          signal: await operationSignal(input.operation),
        });
        mergeMindTrace(trace, run.trace);
        summaries.push((run.result as CharacterMindIngestResult).summary);
        continue;
      }
      const run = await runCharacterMindOperation({
        root: input.context.root,
        operation: "write-index",
        value: JSON.stringify({ action, changePlan: input.plan.actions }),
        target: { path: "index.md", sources: [] },
        candidate: candidates,
        knownWikiPaths,
        runtime: input.runtime,
        signal: await operationSignal(input.operation),
      });
      mergeMindTrace(trace, run.trace);
      const result = run.result as CharacterMindMarkdownResult;
      await candidates.write("index.md", result.content);
      summaries.push(result.summary);
    }

    await validateCompleteWiki(input.context.root, candidates);
    await candidates.publish(trace);
    return { trace, summaries };
  } catch (error) {
    if (error && typeof error === "object") Object.assign(error, { characterMindTrace: trace });
    throw error;
  } finally {
    await candidates.dispose();
  }
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
    const plan = run.result as CharacterMindChangePlan;
    const executed = await executeCharacterMindChangePlan({
      context,
      runtime,
      operation,
      plan,
      discoveryTrace: run.trace,
    });
    trace = executed.trace;
    const result: CharacterMindIngestResult = {
      summary: [plan.summary, ...executed.summaries].filter(Boolean).join(" "),
      created: [...trace.created],
      updated: [...trace.updated],
    };
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
  const built = hasSuccessfulBuild(entries);
  const last = entries.at(-1);
  const active = activeOperations.get(key(chatId, characterId));
  const revisions = await currentRevisions(db, context);
  return {
    initialized,
    built,
    path: initialized ? await mindDiskPath(context.root) : null,
    currentRevisions: revisions,
    pendingSources: built ? await pendingSources(context.root, new Set(revisions)) : [],
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
  restart = false,
): Promise<CharacterMindBuildOrSyncResult> {
  const context = await loadContext(db, chatId, characterId);
  const runtime = await requireRuntime(db, context);
  const initialized = await pathExists(context.root);
  const entries = initialized ? parseMindLog(await readMindLog(context.root)) : [];
  const built = hasSuccessfulBuild(entries);
  if (mode === "build" && built) throw new CharacterMindError("Character Mind is already built; use Sync", 409);
  if (mode === "sync" && !initialized)
    throw new CharacterMindError("Character Mind is not initialized; use Build", 409);
  if (mode === "sync" && !built) throw new CharacterMindError("Character Mind Build is incomplete; retry Build", 409);
  const operation = claimOperation(chatId, characterId, mode);
  try {
    if (mode === "build") await initializeMind(context.root);
    const snapshots = await snapshotInputs(db, context);
    const current = new Set(snapshots.map((snapshot) => snapshot.revision));
    const processed: CharacterMindBuildOrSyncResult["processed"] = [];
    if (mode === "build") {
      const result = await buildCorpus(context, runtime, operation, snapshots, restart);
      processed.push(...snapshots.map((snapshot) => ({ source: snapshot.path, result, error: null })));
      return {
        snapshotsCreated: snapshots.filter((snapshot) => snapshot.created).map((snapshot) => snapshot.path),
        processed,
        pendingSources: await pendingSources(context.root, current),
      };
    }
    const pending = await pendingSources(context.root, current);
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
      pendingSources: await pendingSources(context.root, current),
    };
  } finally {
    finishOperation(chatId, characterId, operation);
    if (await pathExists(context.root)) void maybeQueueAutomaticLint(db, chatId, characterId).catch(() => undefined);
  }
}

export function buildCharacterMind(db: DB, chatId: string, characterId: string, restart = false) {
  return buildOrSync(db, chatId, characterId, "build", undefined, restart);
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
  if (!hasSuccessfulBuild(parseMindLog(await readMindLog(context.root))))
    throw new CharacterMindError("Character Mind Build is incomplete; retry Build", 409);
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
  if (!hasSuccessfulBuild(parseMindLog(await readMindLog(context.root))))
    throw new CharacterMindError("Character Mind Build is incomplete; retry Build", 409);
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
    const plan = run.result as CharacterMindChangePlan;
    const executed = await executeCharacterMindChangePlan({
      context,
      runtime,
      operation,
      plan,
      discoveryTrace: run.trace,
    });
    const allFindings = [...new Set([...findings, ...plan.findings])];
    const moved = [...executed.trace.moved].flatMap((entry) => entry.split(" -> "));
    const output: CharacterMindLintResult = {
      summary: [plan.summary, ...executed.summaries].filter(Boolean).join(" "),
      findings: allFindings,
      changed: [
        ...new Set([...executed.trace.created, ...executed.trace.updated, ...executed.trace.deleted, ...moved]),
      ],
    };
    await appendMindLog({
      root: context.root,
      operation: "lint",
      subject: "wiki",
      status: "success",
      trace: executed.trace,
      findings: allFindings,
      summary: output.summary,
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
    const root = mindRoot(chatId, characterId);
    if (
      !(await pathExists(root)) ||
      !hasSuccessfulBuild(parseMindLog(await readMindLog(root))) ||
      activeOperations.has(key(chatId, characterId))
    )
      continue;
    void syncCharacterMind(db, chatId, characterId, 1).catch((error) =>
      logger.warn(error, "Automatic Character Mind sync failed"),
    );
  }
}
