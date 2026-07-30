import assert from "node:assert/strict";

import { shouldIncludeConversationSummaryMemories } from "../../packages/shared/src/types/chat.js";
import { buildScheduleContinuityContext } from "../../packages/server/src/routes/conversation.routes.js";
import { prepareConversationPromptHistory } from "../../packages/server/src/routes/generate/conversation-history-runtime.js";
import { resolveConversationSummaryConnection } from "../../packages/server/src/services/conversation/summary-connection.js";

assert.equal(shouldIncludeConversationSummaryMemories({}), true);
assert.equal(shouldIncludeConversationSummaryMemories("{}"), true);
assert.equal(shouldIncludeConversationSummaryMemories({ includeConversationSummaryMemoriesInPrompt: true }), true);
assert.equal(shouldIncludeConversationSummaryMemories({ includeConversationSummaryMemoriesInPrompt: false }), false);

const storedConnections = new Map([
  [
    "chat-connection",
    {
      id: "chat-connection",
      name: "Chat Connection",
      provider: "openai",
      baseUrl: "https://example.invalid/v1",
      apiKey: "",
      model: "chat-model",
      maxContext: 128_000,
      openrouterProvider: null,
      maxTokensOverride: null,
      claudeFastMode: "false",
      treatAsLocalEndpoint: "false",
      defaultParameters: null,
    },
  ],
  [
    "summary-connection",
    {
      id: "summary-connection",
      name: "Summary Connection",
      provider: "openai",
      baseUrl: "https://example.invalid/v1",
      apiKey: "",
      model: "summary-model",
      maxContext: 64_000,
      openrouterProvider: null,
      maxTokensOverride: null,
      claudeFastMode: "false",
      treatAsLocalEndpoint: "false",
      defaultParameters: null,
    },
  ],
  [
    "image-connection",
    {
      id: "image-connection",
      name: "Image Connection",
      provider: "image_generation",
      baseUrl: "https://example.invalid/images",
      apiKey: "",
      model: "image-model",
      maxContext: 0,
      openrouterProvider: null,
      maxTokensOverride: null,
      claudeFastMode: "false",
      treatAsLocalEndpoint: "false",
      defaultParameters: null,
    },
  ],
]);

const connections = {
  async getWithKey(id: string) {
    return storedConnections.get(id) ?? null;
  },
  async getDefault() {
    return storedConnections.get("chat-connection") ?? null;
  },
  async listRandomPool() {
    return [storedConnections.get("chat-connection")!];
  },
  async getFallbackForAgents() {
    return null;
  },
} as any;
const resolveBaseUrl = (connection: { baseUrl: string | null }) => connection.baseUrl ?? "";

const explicitConnection = await resolveConversationSummaryConnection({
  summaryConnectionId: "summary-connection",
  chatConnectionId: "chat-connection",
  connections,
  resolveBaseUrl,
});
assert.equal(explicitConnection.ok, true);
if (explicitConnection.ok) {
  assert.equal(explicitConnection.connectionId, "summary-connection");
  assert.equal(explicitConnection.model, "summary-model");
  assert.equal(explicitConnection.source, "conversation-summary");
}

const missingExplicitConnection = await resolveConversationSummaryConnection({
  summaryConnectionId: "deleted-summary-connection",
  chatConnectionId: "chat-connection",
  connections,
  resolveBaseUrl,
});
assert.equal(missingExplicitConnection.ok, false);
if (!missingExplicitConnection.ok) {
  assert.equal(missingExplicitConnection.connectionId, "deleted-summary-connection");
  assert.match(missingExplicitConnection.error, /was not found/u);
}

const invalidExplicitConnection = await resolveConversationSummaryConnection({
  summaryConnectionId: "image-connection",
  chatConnectionId: "chat-connection",
  connections,
  resolveBaseUrl,
});
assert.equal(invalidExplicitConnection.ok, false);
if (!invalidExplicitConnection.ok) assert.match(invalidExplicitConnection.error, /not a text-generation connection/u);

const defaultConnection = await resolveConversationSummaryConnection({
  summaryConnectionId: null,
  chatConnectionId: "chat-connection",
  connections,
  resolveBaseUrl,
});
assert.equal(defaultConnection.ok, true);
if (defaultConnection.ok) {
  assert.equal(defaultConnection.connectionId, "chat-connection");
  assert.equal(defaultConnection.source, "chat");
}

const historicalMessage = {
  id: "message-1",
  role: "user" as const,
  content: "RAW_SUMMARIZED_TRANSCRIPT",
  characterId: null,
  createdAt: "2026-07-01T12:00:00.000Z",
  extra: {},
};
const baseHistoryArgs = {
  finalMessages: [{ role: "user" as const, content: historicalMessage.content }],
  chatMessages: [historicalMessage],
  scopedMessages: [historicalMessage],
  chatId: "conversation-1",
  chats: {
    async patchMetadata() {
      throw new Error("summary metadata must not be patched without a summary runtime");
    },
  },
  chars: {
    async getById() {
      return null;
    },
  },
  characterIds: ["character-alice"],
  allCharacterIds: ["character-alice"],
  convoCharInfo: [{ name: "Alice" }],
  convoCharNames: ["Alice"],
  personaName: "Morgan",
  nowInstant: new Date("2026-07-02T18:00:00.000Z"),
  promptTimeZone: "UTC",
  wrapFormat: "xml" as const,
  summaryRuntime: null,
};

const includedHistory = await prepareConversationPromptHistory({
  ...baseHistoryArgs,
  chatMeta: {
    summaryTailMessages: 0,
    daySummaries: {
      "01.07.2026": { summary: "DAY_SUMMARY_ALWAYS_INCLUDED", keyDetails: ["SUMMARY_MEMORY_INCLUDED"] },
    },
  },
});
assert.match(
  includedHistory.finalMessages.map((message) => message.content).join("\n"),
  /DAY_SUMMARY_ALWAYS_INCLUDED/u,
);
assert.match(includedHistory.importantMemoryBlock ?? "", /SUMMARY_MEMORY_INCLUDED/u);

const excludedHistory = await prepareConversationPromptHistory({
  ...baseHistoryArgs,
  chatMeta: {
    summaryTailMessages: 0,
    includeConversationSummaryMemoriesInPrompt: false,
    daySummaries: {
      "01.07.2026": { summary: "DAY_SUMMARY_STILL_INCLUDED", keyDetails: ["SUMMARY_MEMORY_EXCLUDED"] },
    },
  },
});
assert.match(excludedHistory.finalMessages.map((message) => message.content).join("\n"), /DAY_SUMMARY_STILL_INCLUDED/u);
assert.equal(excludedHistory.importantMemoryBlock, null);
assert.doesNotMatch(
  excludedHistory.finalMessages.map((message) => message.content).join("\n"),
  /SUMMARY_MEMORY_EXCLUDED/u,
);

const scheduleContext = buildScheduleContinuityContext({
  meta: {
    includeConversationSummaryMemoriesInPrompt: false,
    weekSummaries: {
      "29.06.2026": { summary: "SCHEDULE_WEEK_SUMMARY_INCLUDED", keyDetails: ["SCHEDULE_WEEK_DETAIL_EXCLUDED"] },
    },
    daySummaries: {
      "01.07.2026": { summary: "SCHEDULE_DAY_SUMMARY_INCLUDED", keyDetails: ["SCHEDULE_DAY_DETAIL_EXCLUDED"] },
    },
  },
  charData: { name: "Alice", extensions: {} } as any,
  existingSchedule: { weekStart: "2026-06-29", days: {} } as any,
});
assert.match(scheduleContext, /SCHEDULE_WEEK_SUMMARY_INCLUDED/u);
assert.match(scheduleContext, /SCHEDULE_DAY_SUMMARY_INCLUDED/u);
assert.doesNotMatch(scheduleContext, /SCHEDULE_WEEK_DETAIL_EXCLUDED/u);
assert.doesNotMatch(scheduleContext, /SCHEDULE_DAY_DETAIL_EXCLUDED/u);

console.info("Conversation summary controls regression checks passed.");
