import {
  CORE_BUILT_IN_AGENT_MANIFESTS,
  replaceBuiltInAgentDefinitions,
  type BuiltInAgentManifest,
} from "@marinara-engine/shared";
import { capabilityPackageManager } from "./package-manager.service.js";

export async function initializeCapabilityAgentRegistry(): Promise<void> {
  await refreshCapabilityAgentRegistry();
}

export async function refreshCapabilityAgentRegistry(): Promise<readonly BuiltInAgentManifest[]> {
  const packageDefinitions = await capabilityPackageManager.agentDefinitions();
  const coreIds = new Set(CORE_BUILT_IN_AGENT_MANIFESTS.map((definition) => definition.id));
  const definitions = [
    ...CORE_BUILT_IN_AGENT_MANIFESTS,
    ...packageDefinitions.filter((definition) => !coreIds.has(definition.id)),
  ];
  replaceBuiltInAgentDefinitions(definitions);
  return definitions;
}
