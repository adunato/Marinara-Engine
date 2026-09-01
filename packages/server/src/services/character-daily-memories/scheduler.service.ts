import type { FastifyInstance } from "fastify";
import type {
  CharacterDailyMemoryRun,
  CharacterDailyMemoryRunSource,
  CharacterDailyMemorySettings,
  CharacterDailyMemoryWindow,
} from "@marinara-engine/shared";
import { characterDailyMemorySettings } from "../../db/schema/index.js";
import type { DB } from "../../db/connection.js";
import { eq } from "../../db/file-query.js";
import { logger } from "../../lib/logger.js";
import { createAppSettingsStorage } from "../storage/app-settings.storage.js";
import {
  createCharacterDailyMemoriesStorage,
  type CharacterDailyMemoriesStorage,
} from "../storage/character-daily-memories.storage.js";
import {
  createCharacterDailyMemoryFormationService,
  type CharacterDailyMemoryFormationService,
} from "./formation.service.js";
import { enumerateCompletedWindows, mostRecentCompletedWindow, nextScheduledWindow } from "./window.js";
import { normalizePromptTimeZone } from "../conversation/timezone.js";

const SCHEDULER_LABEL = "[character-daily-memories]";
const DEFAULT_QUEUE_LIMIT = 256;
const REFRESH_DEBOUNCE_MS = 50;
const MAX_TIMER_DELAY_MS = 2_147_000_000;

type Clock = () => Date;
type Timer = ReturnType<typeof setTimeout>;

export type CharacterDailyMemorySchedulerJob = {
  characterId: string;
  window: CharacterDailyMemoryWindow;
  trigger: "scheduled" | "startup";
};

type SchedulerSetting = Pick<
  CharacterDailyMemorySettings,
  "characterId" | "enabled" | "handoverTime" | "autoStartWindowEndAt"
>;

export type CharacterDailyMemorySchedulerDependencies = {
  storage: CharacterDailyMemoriesStorage;
  formation: Pick<CharacterDailyMemoryFormationService, "ensureCharacterMemoryDay">;
  listEnabledSettings: () => Promise<SchedulerSetting[]>;
  getTimeZone: () => Promise<string | undefined>;
  now?: Clock;
  queueLimit?: number;
  scheduleTimer?: (callback: () => void, delayMs: number) => Timer;
  clearTimer?: (timer: Timer) => void;
  onLog?: (level: "info" | "warn", message: string, ...args: unknown[]) => void;
};

type SchedulerStatus = {
  stopped: boolean;
  queueSize: number;
  nextDueAt: string | null;
};

function jobKey(job: CharacterDailyMemorySchedulerJob): string {
  return `${job.characterId}|${job.window.windowEndAt}`;
}

function compareJobs(a: CharacterDailyMemorySchedulerJob, b: CharacterDailyMemorySchedulerJob): number {
  return a.window.windowEndAt.localeCompare(b.window.windowEndAt) || a.characterId.localeCompare(b.characterId);
}

/** Stable oldest-first queue ordering is exported for focused scheduler regressions. */
export function sortCharacterDailyMemoryJobs(
  jobs: CharacterDailyMemorySchedulerJob[],
): CharacterDailyMemorySchedulerJob[] {
  return [...jobs].sort(compareJobs);
}

/** A source is retryable only when persisted backoff has elapsed. */
export function isCharacterDailyMemorySourceRetryable(source: CharacterDailyMemoryRunSource, at: Date): boolean {
  if (source.status === "pending" || source.status === "running") return true;
  if (source.status !== "failed") return false;
  if (!source.nextRetryAt) return true;
  const retryAt = new Date(source.nextRetryAt);
  return !Number.isNaN(retryAt.getTime()) && retryAt.getTime() <= at.getTime();
}

export function isCharacterDailyMemoryRunRetryable(
  run: CharacterDailyMemoryRun,
  sources: CharacterDailyMemoryRunSource[],
  at: Date,
): boolean {
  if (run.status === "complete" || run.status === "empty") return false;
  return sources.length === 0 || sources.some((source) => isCharacterDailyMemorySourceRetryable(source, at));
}

function parseUiTimeZone(value: string | null): string | undefined {
  if (!value) return undefined;
  try {
    const parsed: unknown = JSON.parse(value);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return undefined;
    const candidate = (parsed as { conversationTimeZone?: unknown }).conversationTimeZone;
    return typeof candidate === "string" ? normalizePromptTimeZone(candidate) : undefined;
  } catch {
    return undefined;
  }
}

function defaultLog(level: "info" | "warn", message: string, ...args: unknown[]) {
  if (level === "info") logger.info({ args }, message);
  else logger.warn({ args }, message);
}

/**
 * The scheduler core is dependency-injected so reconciliation, ordering, and
 * shutdown can be tested without booting Fastify or making provider calls.
 */
export function createCharacterDailyMemoryScheduler(deps: CharacterDailyMemorySchedulerDependencies) {
  const now = deps.now ?? (() => new Date());
  const queueLimit = Math.max(1, deps.queueLimit ?? DEFAULT_QUEUE_LIMIT);
  const scheduleTimer = deps.scheduleTimer ?? ((callback, delayMs) => setTimeout(callback, delayMs));
  const clearTimer = deps.clearTimer ?? ((timer) => clearTimeout(timer));
  const log = deps.onLog ?? defaultLog;
  const queue: CharacterDailyMemorySchedulerJob[] = [];
  const queuedJobKeys = new Set<string>();
  let stopped = true;
  let workerRunning = false;
  let reconciling: Promise<void> | null = null;
  let refreshTimer: Timer | null = null;
  let nextDueTimer: Timer | null = null;
  let nextDueAt: string | null = null;
  let reconciliationDeferred = false;

  const clearNextDueTimer = () => {
    if (!nextDueTimer) return;
    clearTimer(nextDueTimer);
    nextDueTimer = null;
  };

  const armNextDueTimer = (dueAt: Date | null) => {
    clearNextDueTimer();
    nextDueAt = dueAt?.toISOString() ?? null;
    if (stopped || !dueAt) return;
    const delay = Math.max(0, Math.min(MAX_TIMER_DELAY_MS, dueAt.getTime() - now().getTime()));
    nextDueTimer = scheduleTimer(() => {
      nextDueTimer = null;
      void reconcile();
    }, delay);
    nextDueTimer.unref?.();
  };

  const enqueue = (job: CharacterDailyMemorySchedulerJob): boolean => {
    const key = jobKey(job);
    if (queuedJobKeys.has(key)) return true;
    if (queue.length >= queueLimit) {
      reconciliationDeferred = true;
      return false;
    }
    queuedJobKeys.add(key);
    queue.push(job);
    queue.sort(compareJobs);
    return true;
  };

  const pump = () => {
    if (stopped || workerRunning) return;
    const job = queue.shift();
    if (!job) {
      if (reconciliationDeferred) {
        reconciliationDeferred = false;
        void reconcile();
      }
      return;
    }
    workerRunning = true;
    void (async () => {
      try {
        log(
          "info",
          `${SCHEDULER_LABEL} forming character %s for window ending %s`,
          job.characterId,
          job.window.windowEndAt,
        );
        await deps.formation.ensureCharacterMemoryDay(job.characterId, job.window, job.trigger);
      } catch (error) {
        // Formation persists source-level retry timing. A scheduler failure is
        // still logged and picked up by the next reconciliation after restart.
        log(
          "warn",
          `${SCHEDULER_LABEL} formation failed for character %s/window %s`,
          job.characterId,
          job.window.windowEndAt,
          error,
        );
      } finally {
        queuedJobKeys.delete(jobKey(job));
        workerRunning = false;
        pump();
      }
    })();
  };

  const reconcileImpl = async (trigger: "scheduled" | "startup") => {
    if (stopped) return;
    const at = now();
    const timeZone = await deps.getTimeZone();
    const settings = (await deps.listEnabledSettings()).filter((setting) => setting.enabled);
    let earliestFutureDue: Date | null = null;

    for (const setting of settings) {
      let latest: CharacterDailyMemoryWindow;
      try {
        latest = mostRecentCompletedWindow(at, setting.handoverTime, timeZone);
      } catch (error) {
        log("warn", `${SCHEDULER_LABEL} ignoring invalid schedule for character %s`, setting.characterId, error);
        continue;
      }
      const future = new Date(nextScheduledWindow(latest.windowEndAt, setting.handoverTime, timeZone).windowEndAt);
      if (!earliestFutureDue || future.getTime() < earliestFutureDue.getTime()) earliestFutureDue = future;

      const anchor = setting.autoStartWindowEndAt;
      const start = anchor && !Number.isNaN(new Date(anchor).getTime()) ? anchor : latest.windowEndAt;
      let windows: CharacterDailyMemoryWindow[];
      try {
        windows = enumerateCompletedWindows(start, at, setting.handoverTime, timeZone);
      } catch (error) {
        log("warn", `${SCHEDULER_LABEL} failed to enumerate windows for character %s`, setting.characterId, error);
        continue;
      }
      for (const window of windows) {
        const day = await deps.storage.getDayByWindow(setting.characterId, window.windowEndAt);
        if (day?.status === "deleted") continue;
        if (!day?.activeRunId) {
          enqueue({ characterId: setting.characterId, window, trigger });
          continue;
        }
        const run = await deps.storage.getRun(day.activeRunId, setting.characterId);
        if (
          !run ||
          !isCharacterDailyMemoryRunRetryable(run, await deps.storage.listRunSources(run.id, setting.characterId), at)
        ) {
          continue;
        }
        enqueue({ characterId: setting.characterId, window, trigger });
      }
    }
    armNextDueTimer(earliestFutureDue);
    log("info", `${SCHEDULER_LABEL} reconciled %d enabled character(s), queue size %d`, settings.length, queue.length);
    pump();
  };

  const reconcile = (trigger: "scheduled" | "startup" = "scheduled"): Promise<void> => {
    if (stopped) return Promise.resolve();
    if (reconciling) return reconciling;
    reconciling = reconcileImpl(trigger)
      .catch((error) => {
        log("warn", `${SCHEDULER_LABEL} reconciliation failed`, error);
      })
      .finally(() => {
        reconciling = null;
      });
    return reconciling;
  };

  const requestRefresh = () => {
    if (stopped || refreshTimer) return;
    refreshTimer = scheduleTimer(() => {
      refreshTimer = null;
      void reconcile();
    }, REFRESH_DEBOUNCE_MS);
    refreshTimer.unref?.();
  };

  const start = () => {
    if (!stopped) return;
    stopped = false;
    // Defer startup reconciliation so app construction and route registration
    // are not held up by database scans or provider work.
    scheduleTimer(() => void reconcile("startup"), 0).unref?.();
    log("info", `${SCHEDULER_LABEL} scheduler started`);
  };

  const stop = () => {
    stopped = true;
    clearNextDueTimer();
    if (refreshTimer) clearTimer(refreshTimer);
    refreshTimer = null;
    nextDueAt = null;
    queue.length = 0;
    queuedJobKeys.clear();
    reconciliationDeferred = false;
  };

  const status = (): SchedulerStatus => ({ stopped, queueSize: queue.length, nextDueAt });

  return { start, stop, requestRefresh, reconcile, status };
}

let activeRefresh: (() => void) | null = null;

/** Safe settings/timezone hook; it intentionally does nothing before startup. */
export function requestCharacterDailyMemorySchedulerRefresh(): void {
  activeRefresh?.();
}

async function listEnabledSettings(db: DB): Promise<SchedulerSetting[]> {
  const rows = await db
    .select({
      characterId: characterDailyMemorySettings.characterId,
      enabled: characterDailyMemorySettings.enabled,
      handoverTime: characterDailyMemorySettings.handoverTime,
      autoStartWindowEndAt: characterDailyMemorySettings.autoStartWindowEndAt,
    })
    .from(characterDailyMemorySettings)
    .where(eq(characterDailyMemorySettings.enabled, "true"));
  return rows.map((row) => ({
    characterId: row.characterId,
    enabled: row.enabled === "true",
    handoverTime: row.handoverTime,
    autoStartWindowEndAt: row.autoStartWindowEndAt,
  }));
}

/** Fastify lifecycle adapter. Wiring remains intentionally owned by app.ts. */
export function startCharacterDailyMemoryScheduler(app: FastifyInstance) {
  const storage = createCharacterDailyMemoriesStorage(app.db);
  const formation = createCharacterDailyMemoryFormationService({ db: app.db, storage });
  const appSettings = createAppSettingsStorage(app.db);
  const scheduler = createCharacterDailyMemoryScheduler({
    storage,
    formation,
    listEnabledSettings: () => listEnabledSettings(app.db),
    getTimeZone: async () => parseUiTimeZone(await appSettings.get("ui")),
  });

  activeRefresh = scheduler.requestRefresh;
  scheduler.start();
  app.addHook("onClose", async () => {
    scheduler.stop();
    if (activeRefresh === scheduler.requestRefresh) activeRefresh = null;
  });
  return scheduler;
}
