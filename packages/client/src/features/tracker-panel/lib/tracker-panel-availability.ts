import type { ChatMode } from "@marinara-engine/shared";

type ChatAgentMetadata = {
  enableAgents?: unknown;
  activeAgentIds?: unknown;
};

export function isCustomTrackerActiveForChat(metadata: ChatAgentMetadata | null | undefined): boolean {
  if (metadata?.enableAgents !== true || !Array.isArray(metadata.activeAgentIds)) return false;
  return metadata.activeAgentIds.includes("custom-tracker");
}

export function isTrackerPanelAvailableForChat(
  mode: ChatMode | null | undefined,
  metadata: ChatAgentMetadata | null | undefined,
): boolean {
  if (mode === "roleplay" || mode === "game") return true;
  return mode === "conversation" && isCustomTrackerActiveForChat(metadata);
}
