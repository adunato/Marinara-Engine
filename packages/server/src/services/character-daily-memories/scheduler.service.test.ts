import assert from "node:assert/strict";
import { test } from "node:test";
import type {
  CharacterDailyMemoryRun,
  CharacterDailyMemoryRunSource,
  CharacterDailyMemoryWindow,
} from "@marinara-engine/shared";
import {
  createCharacterDailyMemoryScheduler,
  isCharacterDailyMemoryRunRetryable,
  isCharacterDailyMemorySourceRetryable,
  sortCharacterDailyMemoryJobs,
} from "./scheduler.service.js";

const source = (patch: Partial<CharacterDailyMemoryRunSource>): CharacterDailyMemoryRunSource => ({
  id: "source",
  runId: "run",
  sourceConversationId: "conversation",
  sourceConversationName: "Conversation",
  status: "pending",
  attempts: 0,
  lastError: null,
  nextRetryAt: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  ...patch,
});

const run = (patch: Partial<CharacterDailyMemoryRun>): CharacterDailyMemoryRun => ({
  id: "run",
  dayId: "day",
  kind: "scheduled",
  status: "partial",
  sourceConversationIds: ["conversation"],
  connectionId: null,
  model: null,
  replacementOfRunId: null,
  startedAt: null,
  completedAt: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  ...patch,
});

test("orders scheduler jobs oldest-first and breaks ties by character", () => {
  const window = (windowEndAt: string): CharacterDailyMemoryWindow => ({
    dayKey: windowEndAt.slice(0, 10),
    windowStartAt: "2026-01-01T00:00:00.000Z",
    windowEndAt,
    handoverTime: "04:00",
  });
  const jobs = sortCharacterDailyMemoryJobs([
    { characterId: "zeta", window: window("2026-01-02T04:00:00.000Z"), trigger: "scheduled" },
    { characterId: "zeta", window: window("2026-01-01T04:00:00.000Z"), trigger: "scheduled" },
    { characterId: "alpha", window: window("2026-01-01T04:00:00.000Z"), trigger: "scheduled" },
  ]);
  assert.deepEqual(
    jobs.map((job) => `${job.window.windowEndAt}:${job.characterId}`),
    [
      "2026-01-01T04:00:00.000Z:alpha",
      "2026-01-01T04:00:00.000Z:zeta",
      "2026-01-02T04:00:00.000Z:zeta",
    ],
  );
});

test("honours persisted source backoff and terminal run states", () => {
  const at = new Date("2026-01-01T01:00:00.000Z");
  assert.equal(isCharacterDailyMemorySourceRetryable(source({ status: "success" }), at), false);
  assert.equal(
    isCharacterDailyMemorySourceRetryable(
      source({ status: "failed", nextRetryAt: "2026-01-01T02:00:00.000Z" }),
      at,
    ),
    false,
  );
  assert.equal(
    isCharacterDailyMemorySourceRetryable(
      source({ status: "failed", nextRetryAt: "2026-01-01T00:59:00.000Z" }),
      at,
    ),
    true,
  );
  assert.equal(isCharacterDailyMemoryRunRetryable(run({ status: "complete" }), [source({ status: "failed" })], at), false);
  assert.equal(isCharacterDailyMemoryRunRetryable(run({ status: "partial" }), [source({ status: "failed" })], at), true);
});

test("reconciliation queues missing windows and drains them sequentially", async () => {
  const timers: Array<{ callback: () => void; unref: () => void }> = [];
  const formed: string[] = [];
  const storage = {
    getDayByWindow: async () => null,
  } as never;
  const scheduler = createCharacterDailyMemoryScheduler({
    storage,
    formation: {
      ensureCharacterMemoryDay: async (characterId, window) => {
        formed.push(`${characterId}|${window.windowEndAt}`);
        return null;
      },
    },
    listEnabledSettings: async () => [
      {
        characterId: "alice",
        enabled: true,
        handoverTime: "04:00",
        autoStartWindowEndAt: "2026-08-30T04:00:00.000Z",
      },
    ],
    getTimeZone: async () => "UTC",
    now: () => new Date("2026-09-01T05:00:00.000Z"),
    scheduleTimer: (callback) => {
      const timer = { callback, unref: () => undefined };
      timers.push(timer);
      return timer as never;
    },
    clearTimer: () => undefined,
    onLog: () => undefined,
  });

  scheduler.start();
  const startup = timers.shift();
  assert.ok(startup);
  startup.callback();
  await scheduler.reconcile();
  for (let attempt = 0; attempt < 10 && formed.length < 3; attempt += 1) await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(formed, [
    "alice|2026-08-30T04:00:00.000Z",
    "alice|2026-08-31T04:00:00.000Z",
    "alice|2026-09-01T04:00:00.000Z",
  ]);
  scheduler.stop();
});
