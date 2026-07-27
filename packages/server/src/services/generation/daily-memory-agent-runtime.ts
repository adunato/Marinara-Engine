import {
  DAILY_MEMORY_AGENT_ID,
  isAgentConfigDeleted,
  mergeBuiltInAgentSettings,
} from "@marinara-engine/shared";
import type { BaseLLMProvider } from "../llm/base-provider.js";
import { withConnectionFallbackProvider } from "../llm/connection-fallback-provider.js";
import { createLLMProvider } from "../llm/provider-registry.js";
import { normalizeDailyMemorySettings, type DailyMemorySettings } from "../conversation/daily-memory.service.js";

type AgentStore = {
  getByType(type: string): Promise<any | null>;
  ensureBuiltinConfig(type: string): Promise<any | null>;
};

type ConnectionStore = {
  getWithKey(id: string): Promise<any | null>;
  getDefaultForAgents(): Promise<any | null>;
  getFallbackForAgents(): Promise<any | null>;
};

export interface DailyMemoryAgentRuntime {
  config: any;
  settings: DailyMemorySettings;
  prompt: string;
  provider: BaseLLMProvider;
  model: string;
}

function parseSettings(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  if (typeof value !== "string" || !value.trim()) return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export function isDailyMemoryAgentEnabled(chatMetadata: Record<string, unknown>): boolean {
  return (
    chatMetadata.enableAgents === true &&
    Array.isArray(chatMetadata.activeAgentIds) &&
    chatMetadata.activeAgentIds.includes(DAILY_MEMORY_AGENT_ID)
  );
}

export async function resolveDailyMemoryAgentRuntime(options: {
  agents: AgentStore;
  connections: ConnectionStore;
  chatMetadata: Record<string, unknown>;
  activeConnection?: any | null;
  activeBaseUrl?: string | null;
  resolveBaseUrl(connection: { baseUrl: string | null; provider: string }): string;
}): Promise<DailyMemoryAgentRuntime | null> {
  if (!isDailyMemoryAgentEnabled(options.chatMetadata)) return null;
  const config =
    (await options.agents.getByType(DAILY_MEMORY_AGENT_ID)) ??
    (await options.agents.ensureBuiltinConfig(DAILY_MEMORY_AGENT_ID));
  if (!config || isAgentConfigDeleted(config.settings)) return null;
  const mergedSettings = mergeBuiltInAgentSettings(DAILY_MEMORY_AGENT_ID, parseSettings(config.settings));
  const requestedConnection =
    (typeof config.connectionId === "string" && config.connectionId.trim()
      ? await options.connections.getWithKey(config.connectionId)
      : null) ??
    (await options.connections.getDefaultForAgents()) ??
    options.activeConnection ??
    null;
  if (!requestedConnection?.model) return null;
  const baseUrl =
    requestedConnection === options.activeConnection && options.activeBaseUrl
      ? options.activeBaseUrl
      : options.resolveBaseUrl(requestedConnection);
  if (!baseUrl) return null;
  const fallback = await options.connections.getFallbackForAgents();
  const primary = createLLMProvider(
    requestedConnection.provider,
    baseUrl,
    requestedConnection.apiKey,
    requestedConnection.maxContext,
    requestedConnection.openrouterProvider,
    requestedConnection.maxTokensOverride,
    requestedConnection.claudeFastMode === "true",
    requestedConnection.treatAsLocalEndpoint === "true",
    requestedConnection.defaultParameters,
  );
  return {
    config,
    settings: normalizeDailyMemorySettings(mergedSettings),
    prompt: typeof config.promptTemplate === "string" ? config.promptTemplate : "",
    provider: withConnectionFallbackProvider({
      primary,
      primaryConnectionId: requestedConnection.id,
      fallbackConnection: fallback,
      fallbackBaseUrl: fallback ? options.resolveBaseUrl(fallback) : "",
      category: "agents",
    }),
    model: requestedConnection.model,
  };
}
