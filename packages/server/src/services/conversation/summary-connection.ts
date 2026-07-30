import { LOCAL_SIDECAR_CONNECTION_ID } from "@marinara-engine/shared";

import type { BaseLLMProvider } from "../llm/base-provider.js";
import { getLocalSidecarProvider, LOCAL_SIDECAR_MODEL } from "../llm/local-sidecar.js";
import { createLLMProvider } from "../llm/provider-registry.js";
import { withConnectionFallbackProvider } from "../llm/connection-fallback-provider.js";
import type { GenerationFallbackNotifier } from "../generation/fallback-notification.js";
import type { LocalSidecarGenerationConnection } from "../generation/local-sidecar-generation-connection.js";
import type { createConnectionsStorage } from "../storage/connections.storage.js";

type ConnectionsStorage = ReturnType<typeof createConnectionsStorage>;
type StoredConnection = NonNullable<Awaited<ReturnType<ConnectionsStorage["getWithKey"]>>>;
type SummaryConnection = StoredConnection | LocalSidecarGenerationConnection;

export type ResolvedConversationSummaryConnection =
  | {
      ok: true;
      provider: BaseLLMProvider;
      model: string;
      connectionId: string;
      source: "conversation-summary" | "chat";
    }
  | {
      ok: false;
      error: string;
      connectionId: string | null;
      source: "conversation-summary" | "chat";
    };

function normalizeConnectionId(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

async function resolveStoredConnection(
  connectionId: string,
  connections: ConnectionsStorage,
  activeConnection?: SummaryConnection | null,
): Promise<SummaryConnection | null> {
  if (connectionId === "random") {
    const pool = await connections.listRandomPool();
    return pool[Math.floor(Math.random() * pool.length)] ?? null;
  }
  if (activeConnection?.id === connectionId) return activeConnection;
  return connections.getWithKey(connectionId);
}

export async function resolveConversationSummaryConnection(options: {
  summaryConnectionId?: unknown;
  chatConnectionId?: string | null;
  activeConnection?: SummaryConnection | null;
  activeBaseUrl?: string | null;
  connections: ConnectionsStorage;
  resolveBaseUrl(connection: Pick<SummaryConnection, "baseUrl" | "provider">): string;
  onFallback?: GenerationFallbackNotifier;
}): Promise<ResolvedConversationSummaryConnection> {
  const explicitConnectionId = normalizeConnectionId(options.summaryConnectionId);
  const source = explicitConnectionId ? "conversation-summary" : "chat";
  let requestedConnectionId = explicitConnectionId;

  if (!requestedConnectionId && options.activeConnection?.id) {
    requestedConnectionId = options.activeConnection.id;
  }
  if (!requestedConnectionId) requestedConnectionId = normalizeConnectionId(options.chatConnectionId);
  if (!requestedConnectionId) {
    const defaultConnection = await options.connections.getDefault();
    requestedConnectionId = defaultConnection?.id ?? null;
  }

  if (!requestedConnectionId) {
    return { ok: false, error: "No API connection configured for Conversation summaries", connectionId: null, source };
  }

  if (requestedConnectionId === LOCAL_SIDECAR_CONNECTION_ID) {
    const fallback = await options.connections.getFallbackForAgents();
    return {
      ok: true,
      provider: withConnectionFallbackProvider({
        primary: getLocalSidecarProvider(),
        primaryConnectionId: LOCAL_SIDECAR_CONNECTION_ID,
        fallbackConnection: fallback,
        fallbackBaseUrl: fallback ? options.resolveBaseUrl(fallback) : "",
        category: "agents",
        onFallback: options.onFallback,
      }),
      model: LOCAL_SIDECAR_MODEL,
      connectionId: LOCAL_SIDECAR_CONNECTION_ID,
      source,
    };
  }

  const connection = await resolveStoredConnection(
    requestedConnectionId,
    options.connections,
    options.activeConnection,
  );
  if (!connection) {
    const message =
      requestedConnectionId === "random"
        ? "No connections are marked for the random pool"
        : `Conversation summary connection ${requestedConnectionId} was not found`;
    return { ok: false, error: message, connectionId: requestedConnectionId, source };
  }
  if (connection.provider === "image_generation" || connection.provider === "video_generation") {
    return {
      ok: false,
      error: `Connection ${connection.id} is not a text-generation connection`,
      connectionId: connection.id,
      source,
    };
  }
  if (!connection.model?.trim()) {
    return {
      ok: false,
      error: `Connection ${connection.id} has no model configured`,
      connectionId: connection.id,
      source,
    };
  }

  const baseUrl =
    connection === options.activeConnection && options.activeBaseUrl
      ? options.activeBaseUrl
      : options.resolveBaseUrl(connection);
  if (!baseUrl) {
    return {
      ok: false,
      error: `Connection ${connection.id} has no base URL configured`,
      connectionId: connection.id,
      source,
    };
  }

  const fallback = await options.connections.getFallbackForAgents();
  const primary = createLLMProvider(
    connection.provider,
    baseUrl,
    connection.apiKey,
    connection.maxContext,
    connection.openrouterProvider,
    connection.maxTokensOverride,
    connection.claudeFastMode === "true",
    connection.treatAsLocalEndpoint === "true",
    connection.defaultParameters,
  );
  return {
    ok: true,
    provider: withConnectionFallbackProvider({
      primary,
      primaryConnectionId: connection.id,
      fallbackConnection: fallback,
      fallbackBaseUrl: fallback ? options.resolveBaseUrl(fallback) : "",
      category: "agents",
      onFallback: options.onFallback,
    }),
    model: connection.model,
    connectionId: connection.id,
    source,
  };
}
