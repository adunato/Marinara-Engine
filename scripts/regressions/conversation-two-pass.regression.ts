import assert from "node:assert/strict";

import {
  buildConversationCuratorMessages,
  buildConversationWriterMessages,
  createConversationSourceSnapshot,
} from "../../packages/server/src/routes/generate/conversation-two-pass-runtime.js";

const sourceScaffold = "STANDARD_RESPONSE_TEMPLATE_MUST_NOT_LEAK";
const resolvedSourceMessages = [
  {
    role: "system" as const,
    content: `${sourceScaffold}\n\nCHARACTER_CARD_SECRET_7f1d\n\nPERSONA_SECRET_2a9c`,
  },
  { role: "system" as const, content: "DAILY_MEMORY_SECRET_b84e" },
  { role: "user" as const, content: "TRANSCRIPT_SECRET_19ca" },
  { role: "system" as const, content: "LORE_SECRET_673e" },
  { role: "user" as const, content: "PREGEN_AGENT_SECRET_8d40" },
];

const sourceSnapshot = createConversationSourceSnapshot(resolvedSourceMessages, sourceScaffold);
const sourceText = sourceSnapshot.map((message) => message.content).join("\n");
const sourceMarkers = [
  "CHARACTER_CARD_SECRET_7f1d",
  "PERSONA_SECRET_2a9c",
  "DAILY_MEMORY_SECRET_b84e",
  "TRANSCRIPT_SECRET_19ca",
  "LORE_SECRET_673e",
  "PREGEN_AGENT_SECRET_8d40",
];
for (const marker of sourceMarkers) assert.match(sourceText, new RegExp(marker));
assert.doesNotMatch(sourceText, /STANDARD_RESPONSE_TEMPLATE_MUST_NOT_LEAK/u);

resolvedSourceMessages[1]!.content = "MUTATED_AFTER_SNAPSHOT";
assert.match(sourceSnapshot[1]!.content, /DAILY_MEMORY_SECRET_b84e/u);

const curatorMessages = buildConversationCuratorMessages("CURATOR_SYSTEM_PROMPT", sourceSnapshot);
for (const marker of sourceMarkers) assert.match(curatorMessages[1]!.content, new RegExp(marker));

const writerMessages = buildConversationWriterMessages({
  writerPrompt: "WRITER_SYSTEM_PROMPT",
  briefing: "Only the curated fact needed now.",
  technicalContracts: ["HOST_OUTPUT_CONTRACT"],
});
const writerText = writerMessages.map((message) => message.content).join("\n");
assert.match(writerText, /WRITER_SYSTEM_PROMPT/u);
assert.match(writerText, /Only the curated fact needed now\./u);
assert.match(writerText, /HOST_OUTPUT_CONTRACT/u);
assert.doesNotMatch(writerText, /CURATOR_SYSTEM_PROMPT/u);
assert.doesNotMatch(writerText, /STANDARD_RESPONSE_TEMPLATE_MUST_NOT_LEAK/u);
for (const marker of sourceMarkers) assert.doesNotMatch(writerText, new RegExp(marker));

console.log("ok - two-pass Conversation source parity and writer isolation");
