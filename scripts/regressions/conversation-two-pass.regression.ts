import assert from "node:assert/strict";

import {
  DEFAULT_CONVERSATION_CONTEXT_SOURCE_ROLES,
  normalizeConversationContextSourceRoles,
} from "../../packages/shared/src/types/chat.js";
import {
  assembleConversationBriefingArtifact,
  conversationBriefingNeedsFullBuild,
  splitConversationBriefingArtifact,
} from "../../packages/server/src/services/generation/conversation-context-briefing-state.js";
import {
  executeConversationBatchedSourceRequest,
  extractConversationContextSources,
  renderConversationAlwaysIncludeSources,
} from "../../packages/server/src/services/generation/conversation-context-sources.js";
import {
  buildConversationWriterMessages,
  parseConversationFastPathDecision,
} from "../../packages/server/src/routes/generate/conversation-two-pass-runtime.js";

const normalized = normalizeConversationContextSourceRoles({ recentExchange: "always_exclude", memories: "always_include" });
assert.equal(normalized.recentExchange, "agent_curated");
assert.equal(normalized.memories, "always_include");
assert.equal(DEFAULT_CONVERSATION_CONTEXT_SOURCE_ROLES.characterCard, "always_include");
assert.equal(DEFAULT_CONVERSATION_CONTEXT_SOURCE_ROLES.memories, "agent_curated");

const scaffold = "CR032_RESPONSE_SCAFFOLD";
const prepared = [
  { role: "system" as const, content: `${scaffold}\n<character_info>CHARACTER_CARD_SECRET</character_info>` },
  { role: "system" as const, content: "<persona>PERSONA_SECRET</persona>" },
  { role: "system" as const, content: "<memories>MEMORY_SECRET</memories>" },
  { role: "system" as const, content: "<lorebook>LORE_SECRET</lorebook>" },
  { role: "user" as const, content: "LATEST_USER_SECRET" },
];
const sources = extractConversationContextSources(prepared, scaffold);
assert.match(sources.get("characterCard")?.content ?? "", /CHARACTER_CARD_SECRET/u);
assert.match(sources.get("persona")?.content ?? "", /PERSONA_SECRET/u);
assert.match(sources.get("memories")?.content ?? "", /MEMORY_SECRET/u);
assert.match(sources.get("recentExchange")?.content ?? "", /LATEST_USER_SECRET/u);

const roles = normalizeConversationContextSourceRoles(undefined);
const injected = renderConversationAlwaysIncludeSources(sources, roles);
assert.match(injected.markdown, /CHARACTER_CARD_SECRET/u);
assert.doesNotMatch(injected.markdown, /MEMORY_SECRET/u);
const batch = await executeConversationBatchedSourceRequest({
  request: { query: { memories: { search: "memory" }, reactRules: { include: true } } },
  sources,
  roles,
});
assert.match(batch.markdown, /MEMORY_SECRET/u);
assert.equal(batch.returnedKeys.includes("memories"), true);
assert.equal(batch.returnedKeys.includes("reactRules"), false);

const dynamicBatch = await executeConversationBatchedSourceRequest({
  request: { query: { memories: { search: "newly relevant memory" } } },
  sources: new Map(),
  roles,
  resolveCuratedSource: async (key) =>
    key === "memories" ? { key, content: "DYNAMIC_MEMORY_SECRET", images: [], files: [] } : undefined,
});
assert.match(dynamicBatch.markdown, /DYNAMIC_MEMORY_SECRET/u);
assert.deepEqual(dynamicBatch.returnedKeys, ["memories"]);

const artifact = assembleConversationBriefingArtifact(injected.markdown, "## Current Situation\nContinuing.");
const split = splitConversationBriefingArtifact(artifact);
assert.ok(split);
assert.match(split!.sources, /CHARACTER_CARD_SECRET/u);
assert.match(split!.briefing, /Continuing/u);

const metadata = {
  conversationContextBriefing: artifact,
  conversationContextBriefingState: {
    schemaVersion: 1,
    logicalDayKey: "2099-1-1",
    revision: 2,
    updatedAt: new Date().toISOString(),
    contributingSources: ["characterCard", "memories"],
  },
  conversationContextSourceRoles: { memories: "always_exclude" },
};
const invalid = conversationBriefingNeedsFullBuild({
  metadata,
  roles: normalizeConversationContextSourceRoles(metadata.conversationContextSourceRoles),
  availableSources: new Set(sources.keys()),
  now: new Date("2099-01-01T12:00:00Z"),
});
assert.equal(invalid.required, true);
assert.match(invalid.reason, /source_invalidated:memories/u);

assert.deepEqual(parseConversationFastPathDecision('{"fastPath":true,"reason":"routine"}'), {
  fastPath: true,
  reason: "routine",
});

const writer = buildConversationWriterMessages({
  writerPrompt: "WRITER_SYSTEM_PROMPT",
  briefing: artifact,
  technicalContracts: ["HOST_OUTPUT_CONTRACT"],
});
const writerText = writer.map((message) => message.content).join("\n");
assert.match(writerText, /WRITER_SYSTEM_PROMPT/u);
assert.match(writerText, /Conversation Context Briefing/u);
assert.match(writerText, /HOST_OUTPUT_CONTRACT/u);
assert.doesNotMatch(writerText, /MEMORY_SECRET/u);

console.log("ok - CR037 stateful Two-Pass context contracts");
