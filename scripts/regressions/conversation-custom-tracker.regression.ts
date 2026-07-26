import assert from "node:assert/strict";
import {
  CONVERSATION_ALLOWED_AGENT_IDS,
  isAgentManifestAvailableInChatMode,
} from "../../packages/shared/src/constants/chat-mode-capabilities.js";
import { buildCommittedTrackerContextBlock } from "../../packages/server/src/services/generation/committed-tracker-context.js";
import {
  isCustomTrackerActiveForChat,
  isTrackerPanelAvailableForChat,
} from "../../packages/client/src/features/tracker-panel/lib/tracker-panel-availability.js";
import { createEmptyGameState } from "../../packages/client/src/hooks/use-game-state-patcher.js";

assert.deepEqual(CONVERSATION_ALLOWED_AGENT_IDS, ["custom-tracker"]);
assert.equal(
  isAgentManifestAvailableInChatMode("conversation", {
    id: "custom-tracker",
    execution: "pipeline",
  }),
  true,
);
assert.equal(
  isAgentManifestAvailableInChatMode("conversation", {
    id: "custom-tracker",
    execution: "pipeline",
    modeAllowlist: ["roleplay"],
  }),
  false,
);
assert.equal(
  isAgentManifestAvailableInChatMode("conversation", {
    id: "world-state",
    execution: "pipeline",
  }),
  false,
);

const activeMetadata = { enableAgents: true, activeAgentIds: ["custom-tracker"] };
assert.equal(isCustomTrackerActiveForChat(activeMetadata), true);
assert.equal(isCustomTrackerActiveForChat({ ...activeMetadata, enableAgents: false }), false);
assert.equal(isTrackerPanelAvailableForChat("conversation", activeMetadata), true);
assert.equal(isTrackerPanelAvailableForChat("conversation", { enableAgents: true, activeAgentIds: [] }), false);
assert.equal(isTrackerPanelAvailableForChat("roleplay", null), true);
assert.deepEqual(createEmptyGameState("new-conversation").playerStats, null);
assert.equal(createEmptyGameState("new-conversation").chatId, "new-conversation");

const context = buildCommittedTrackerContextBlock({
  chatEnableAgents: true,
  activeAgentIds: ["custom-tracker"],
  latestGameState: {
    playerStats: {
      customTrackerFields: [
        { name: "Relationship", value: "Close friends" },
        { name: "Promise", value: "Meet on Friday", locked: true },
      ],
    },
  },
  chatMetadata: {},
  wrapFormat: "markdown",
});
assert.match(context ?? "", /Custom Tracker/);
assert.match(context ?? "", /Relationship: Close friends/);
assert.match(context ?? "", /Promise: Meet on Friday/);
assert.equal(
  buildCommittedTrackerContextBlock({
    chatEnableAgents: false,
    activeAgentIds: ["custom-tracker"],
    latestGameState: { playerStats: { customTrackerFields: [{ name: "Hidden", value: "No" }] } },
    chatMetadata: {},
    wrapFormat: "markdown",
  }),
  null,
);

console.log("Conversation Custom Tracker regression checks passed.");
