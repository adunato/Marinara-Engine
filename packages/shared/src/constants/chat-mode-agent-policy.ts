// ──────────────────────────────────────────────
// Chat Mode Agent Policy
// ──────────────────────────────────────────────
// Shared rules for which built-in agents can run in each chat mode.

import type { ChatMode } from "../types/chat.js";
import { BUILT_IN_AGENTS, isRetiredBuiltInAgentId, type BuiltInAgentMeta } from "../types/agent.js";

type ChatModeAgentPolicy = { kind: "all" } | { kind: "allowlist"; allowedAgentIds: readonly string[] };

const CHAT_MODE_AGENT_POLICIES: Record<ChatMode, ChatModeAgentPolicy> = {
  // Conversation mode's About Me profile and update_about_me tool are core
  // features, not downloadable agents. The Expression Engine is also usable
  // in Conversation; custom agents remain allowed through the unknown-id path.
  conversation: { kind: "allowlist", allowedAgentIds: ["expression"] },
  roleplay: { kind: "all" },
  // Music DJ is opt-in through the game music toggle, not enabled by default.
  game: { kind: "allowlist", allowedAgentIds: ["spotify"] },
};

export function isAgentManifestAvailableInChatMode(
  mode: ChatMode | null | undefined,
  agent: Pick<BuiltInAgentMeta, "id" | "modeAllowlist" | "execution">,
): boolean {
  if (isRetiredBuiltInAgentId(agent.id)) return false;
  const policyMode = mode ?? "roleplay";
  // Older downloadable Expression manifests declared Roleplay only. Keep them
  // usable in Conversation while package metadata catches up.
  if (agent.id !== "expression" && agent.modeAllowlist?.length && !agent.modeAllowlist.includes(policyMode)) return false;
  if (agent.execution === "feature" || agent.execution === "host") return true;
  const policy = CHAT_MODE_AGENT_POLICIES[policyMode] ?? CHAT_MODE_AGENT_POLICIES.roleplay;
  return policy.kind === "all" || policy.allowedAgentIds.includes(agent.id);
}

export function isAgentAvailableInChatMode(mode: ChatMode | null | undefined, agentId: string): boolean {
  if (isRetiredBuiltInAgentId(agentId)) return false;
  const builtIn = BUILT_IN_AGENTS.find((agent) => agent.id === agentId);
  return builtIn ? isAgentManifestAvailableInChatMode(mode, builtIn) : true;
}
