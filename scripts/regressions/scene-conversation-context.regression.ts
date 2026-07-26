import assert from "node:assert/strict";

import {
  buildSceneConversationContext,
  resolveSceneConversationContext,
  type SceneContextMessage,
} from "../../packages/server/src/services/conversation/scene-context.js";
import { injectSceneContextMessages } from "../../packages/server/src/services/generation/scene-context-runtime.js";

const message = (
  role: string,
  content: string,
  createdAt: string,
  options: { characterId?: string; extra?: Record<string, unknown> } = {},
): SceneContextMessage => ({
  role,
  content,
  createdAt,
  characterId: options.characterId ?? null,
  extra: options.extra ?? {},
});

const currentDayMessages = Array.from({ length: 45 }, (_, index) =>
  message(
    index % 2 === 0 ? "user" : "assistant",
    `CURRENT_DAY_${index}_${"x".repeat(120)}`,
    `2026-07-15T${String(8 + Math.floor(index / 6)).padStart(2, "0")}:${String((index % 6) * 10).padStart(2, "0")}:00.000Z`,
    index % 2 === 0 ? {} : { characterId: "char-alice" },
  ),
);

const context = buildSceneConversationContext({
  metadata: {
    dayRolloverHour: 4,
    summaryTailMessages: 2,
    weekSummaries: {
      "06.07.2026": {
        summary: "WEEKLY_SUMMARY_INCLUDED",
        keyDetails: ["WEEKLY_DETAIL_INCLUDED"],
      },
    },
    daySummaries: {
      "05.07.2026": {
        summary: "UNCOVERED_DAILY_SUMMARY_INCLUDED",
        keyDetails: ["UNCOVERED_DAILY_DETAIL_INCLUDED"],
      },
      "07.07.2026": {
        summary: "COVERED_DAILY_SUMMARY_OMITTED",
        keyDetails: ["COVERED_DAILY_DETAIL_OMITTED"],
      },
      "14.07.2026": {
        summary: "PRIOR_DAY_SUMMARY_INCLUDED",
        keyDetails: ["PRIOR_DAY_DETAIL_INCLUDED"],
      },
    },
  },
  messages: [
    message("user", "PRE_START_MESSAGE_OMITTED", "2026-07-13T08:00:00.000Z"),
    message("narrator", "Conversation restarted", "2026-07-13T09:00:00.000Z", {
      extra: { isConversationStart: true },
    }),
    message("user", "OLDER_UNSUMMARIZED_INCLUDED", "2026-07-13T09:05:00.000Z"),
    message("user", "TAIL_MESSAGE_A_OMITTED", "2026-07-14T08:00:00.000Z"),
    message("assistant", "TAIL_MESSAGE_B_INCLUDED", "2026-07-14T09:00:00.000Z", {
      characterId: "char-alice",
    }),
    message("user", "TAIL_MESSAGE_C_INCLUDED", "2026-07-14T10:00:00.000Z"),
    message("narrator", "SUMMARIZED_NARRATOR_NOT_IN_TAIL", "2026-07-14T11:00:00.000Z"),
    message("user", "GLOBAL_HIDDEN_OMITTED", "2026-07-15T07:00:00.000Z", {
      extra: { hiddenFromAI: true },
    }),
    message("assistant", "CHARACTER_HIDDEN_OMITTED", "2026-07-15T07:10:00.000Z", {
      characterId: "char-alice",
      extra: { hiddenFromAICharacterIds: ["char-alice"] },
    }),
    message("assistant", "RAW_COMMAND_WRAPPER_OMITTED", "2026-07-15T07:20:00.000Z", {
      characterId: "char-alice",
      extra: { conversationCommandContent: "COMMAND_VISIBLE_CONTENT <thinking>& continuity" },
    }),
    message("narrator", "CURRENT_NARRATOR_INCLUDED", "2026-07-15T07:30:00.000Z"),
    ...currentDayMessages,
  ],
  personaName: "Morgan",
  characterNames: new Map([["char-alice", "Alice"]]),
  now: new Date("2026-07-15T18:00:00.000Z"),
  timeZone: "UTC",
});

assert.match(context, /WEEKLY_SUMMARY_INCLUDED/u);
assert.match(context, /WEEKLY_DETAIL_INCLUDED/u);
assert.match(context, /UNCOVERED_DAILY_SUMMARY_INCLUDED/u);
assert.match(context, /UNCOVERED_DAILY_DETAIL_INCLUDED/u);
assert.match(context, /PRIOR_DAY_SUMMARY_INCLUDED/u);
assert.match(context, /PRIOR_DAY_DETAIL_INCLUDED/u);
assert.doesNotMatch(context, /COVERED_DAILY_SUMMARY_OMITTED/u);
assert.doesNotMatch(context, /COVERED_DAILY_DETAIL_OMITTED/u);
assert.match(context, /OLDER_UNSUMMARIZED_INCLUDED/u);
assert.doesNotMatch(context, /PRE_START_MESSAGE_OMITTED/u);
assert.doesNotMatch(context, /TAIL_MESSAGE_A_OMITTED/u);
assert.match(context, /TAIL_MESSAGE_B_INCLUDED/u);
assert.match(context, /TAIL_MESSAGE_C_INCLUDED/u);
assert.doesNotMatch(context, /SUMMARIZED_NARRATOR_NOT_IN_TAIL/u);
assert.doesNotMatch(context, /GLOBAL_HIDDEN_OMITTED/u);
assert.doesNotMatch(context, /CHARACTER_HIDDEN_OMITTED/u);
assert.doesNotMatch(context, /RAW_COMMAND_WRAPPER_OMITTED/u);
assert.match(context, /COMMAND_VISIBLE_CONTENT <thinking>& continuity/u);
assert.match(context, /CURRENT_NARRATOR_INCLUDED/u);
assert.match(context, /CURRENT_DAY_0_/u);
assert.match(context, /CURRENT_DAY_44_/u);
assert.ok(context.length > 3_000, "the complete current day must not be clipped to the legacy 3,000-character cap");

const rolloverContext = buildSceneConversationContext({
  metadata: { dayRolloverHour: 4, summaryTailMessages: 0 },
  messages: [
    message("user", "BEFORE_ROLLOVER_OLD_DAY", "2026-07-14T03:59:00.000Z"),
    message("user", "AFTER_ROLLOVER_CURRENT_DAY", "2026-07-14T04:00:00.000Z"),
    message("assistant", "LATE_NIGHT_CURRENT_DAY", "2026-07-15T02:00:00.000Z", { characterId: "char-alice" }),
  ],
  personaName: "Morgan",
  characterNames: new Map([["char-alice", "Alice"]]),
  now: new Date("2026-07-15T02:30:00.000Z"),
  timeZone: "UTC",
});
assert.match(
  rolloverContext,
  /<current_day date="14\.07\.2026">[\s\S]*AFTER_ROLLOVER_CURRENT_DAY[\s\S]*LATE_NIGHT_CURRENT_DAY/u,
);
assert.doesNotMatch(
  rolloverContext.match(/<current_day[\s\S]*?<\/current_day>/u)?.[0] ?? "",
  /BEFORE_ROLLOVER_OLD_DAY/u,
);
assert.doesNotMatch(rolloverContext, /<recent_summary_tail>/u);

let fallbackCalls = 0;
const captured = await resolveSceneConversationContext("CAPTURE_MARKER", async () => {
  fallbackCalls += 1;
  return "fallback";
});
assert.equal(captured, "CAPTURE_MARKER");
assert.equal(fallbackCalls, 0);
assert.equal(
  await resolveSceneConversationContext(undefined, async () => {
    fallbackCalls += 1;
    return "FALLBACK_CONTEXT";
  }),
  "FALLBACK_CONTEXT",
);
assert.equal(fallbackCalls, 1);

const promptMessages = [{ role: "system" as const, content: "base" }];
injectSceneContextMessages({
  messages: promptMessages,
  chatMetadata: { sceneConversationContext: captured },
  charInfo: [{ id: "char-alice", name: "Alice", description: "" }],
  personaName: "Morgan",
});
assert.equal(
  (
    promptMessages
      .map((entry) => entry.content)
      .join("\n")
      .match(/CAPTURE_MARKER/gu) ?? []
  ).length,
  1,
);
assert.match(promptMessages.map((entry) => entry.content).join("\n"), /structured history snapshot/u);

console.info("Scene Conversation context regression checks passed.");
