import assert from "node:assert/strict";
import { resolveAgentPipelineAgents } from "../../packages/server/src/services/generation/agent-resolution.js";

const result = await resolveAgentPipelineAgents({
  connections: {
    getWithKey: async () => null,
    getDefaultForAgents: async () => null,
    getFallbackForAgents: async () => null,
  },
  configuredAgents: [
    { id: "daily-memory", type: "daily-memory", name: "Daily Conversation Memories", settings: {} },
    { id: "daily-intentions", type: "daily-intentions", name: "Daily Intentions", settings: {} },
  ],
  chatId: "managed-agent-regression",
  chatEnableAgents: true,
  hasPerChatAgentList: false,
  perChatAgentSet: new Set<string>(),
  agentPromptTemplateSelections: {},
  chatProvider: {} as any,
  chatConnectionId: "chat-connection",
  chatModel: "test-model",
  chatCustomParameters: {},
  chatMaxOutputTokens: null,
  chatMaxParallelJobs: 1,
  chatEnableCaching: false,
  chatAnthropicExtendedCacheTtl: false,
  chatCachingAtDepth: 5,
  resolveBaseUrl: () => "",
});

assert.deepEqual(
  result.enabledConfigs.map((agent) => agent.type),
  [],
  "managed Conversation agents must not be eligible for the generic agent pipeline",
);
assert.deepEqual(result.resolvedAgents, []);

console.log("Managed agent pipeline regression passed.");
