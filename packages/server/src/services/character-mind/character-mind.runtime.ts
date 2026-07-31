import { jsonrepair } from "jsonrepair";
import {
  CHARACTER_MIND_AGENT_ID,
  isAgentConfigDeleted,
  type CharacterMindIngestResult,
  type CharacterMindLintResult,
  type CharacterMindQueryResult,
} from "@marinara-engine/shared";
import type { DB } from "../../db/connection.js";
import { createLLMProvider } from "../llm/provider-registry.js";
import { withConnectionFallbackProvider } from "../llm/connection-fallback-provider.js";
import { resolveBaseUrl } from "../generation/connection-base-url.js";
import type { BaseLLMProvider, ChatMessage } from "../llm/base-provider.js";
import { withLlmRequestTimeout } from "../llm/base-provider.js";
import { createAgentsStorage } from "../storage/agents.storage.js";
import { createConnectionsStorage } from "../storage/connections.storage.js";
import {
  CHARACTER_MIND_MAX_OUTPUT_TOKENS,
  CHARACTER_MIND_MAX_TOOL_ROUNDS,
  CHARACTER_MIND_OPERATION_TIMEOUT_MS,
  characterMindPrompt,
} from "./character-mind.constants.js";
import { listMarkdown, normalizeMindPath } from "./character-mind.files.js";
import { createCharacterMindTools, createCharacterMindTrace, type CharacterMindTrace } from "./character-mind.tools.js";

type RuntimeOperation = "ingest" | "query" | "lint";

export interface CharacterMindRuntime {
  provider: BaseLLMProvider;
  model: string;
  prompt: string;
  enableCaching: boolean;
}

export function isCharacterMindAgentEnabled(metadata: Record<string, unknown>): boolean {
  return (
    metadata.enableAgents === true &&
    Array.isArray(metadata.activeAgentIds) &&
    metadata.activeAgentIds.includes(CHARACTER_MIND_AGENT_ID)
  );
}

export async function resolveCharacterMindRuntime(
  db: DB,
  input: { metadata: Record<string, unknown>; chatConnectionId?: string | null },
): Promise<CharacterMindRuntime | null> {
  if (!isCharacterMindAgentEnabled(input.metadata)) return null;
  const agents = createAgentsStorage(db);
  const connections = createConnectionsStorage(db);
  const config =
    (await agents.getByType(CHARACTER_MIND_AGENT_ID)) ?? (await agents.ensureBuiltinConfig(CHARACTER_MIND_AGENT_ID));
  if (!config || isAgentConfigDeleted(config.settings)) return null;
  const connection =
    (config.connectionId ? await connections.getWithKey(config.connectionId) : null) ??
    (await connections.getDefaultForAgents()) ??
    (input.chatConnectionId ? await connections.getWithKey(input.chatConnectionId) : null);
  if (!connection?.model) return null;
  const baseUrl = resolveBaseUrl(connection);
  if (!baseUrl) return null;
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
  const fallback = await connections.getFallbackForAgents();
  return {
    provider: withConnectionFallbackProvider({
      primary,
      primaryConnectionId: connection.id,
      fallbackConnection: fallback,
      fallbackBaseUrl: fallback ? resolveBaseUrl(fallback) : "",
      category: "agents",
    }),
    model: connection.model,
    prompt: typeof config.promptTemplate === "string" ? config.promptTemplate.trim() : "",
    enableCaching: connection.enableCaching === "true",
  };
}

function parseObject(content: string): Record<string, unknown> {
  const trimmed = content.trim();
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(trimmed)?.[1] ?? trimmed;
  try {
    const value = JSON.parse(fenced);
    if (value && typeof value === "object" && !Array.isArray(value)) return value;
  } catch {
    try {
      const value = JSON.parse(jsonrepair(fenced));
      if (value && typeof value === "object" && !Array.isArray(value)) return value;
    } catch {
      // Fall through to the operation error.
    }
  }
  throw new Error("Character Mind agent returned invalid JSON");
}

function strings(value: unknown): string[] {
  return Array.isArray(value)
    ? value
        .filter((item): item is string => typeof item === "string")
        .map((item) => item.trim())
        .filter(Boolean)
    : [];
}

function groundedPaths(value: unknown, allowed: Set<string>, area?: "wiki" | "raw"): string[] {
  const result: string[] = [];
  for (const path of strings(value)) {
    let normalized: string;
    try {
      normalized = normalizeMindPath(path);
    } catch {
      continue;
    }
    if (area && !normalized.startsWith(`${area}/`)) continue;
    if (allowed.has(normalized)) result.push(normalized);
  }
  return [...new Set(result)];
}

function validateResult(operation: RuntimeOperation, value: Record<string, unknown>, trace: CharacterMindTrace) {
  if (operation === "ingest") {
    const summary = typeof value.summary === "string" ? value.summary.trim() : "";
    if (!summary) throw new Error("Character Mind ingest result has no summary");
    return {
      summary,
      created: [...trace.created],
      updated: [...trace.updated],
    } satisfies CharacterMindIngestResult;
  }
  if (operation === "query") {
    const briefing = typeof value.briefing === "string" ? value.briefing.trim() : "";
    if (!briefing) throw new Error("Character Mind query result has no briefing");
    const wikiPages = groundedPaths(value.wikiPages, trace.read, "wiki");
    const rawSources = groundedPaths(value.rawSources, trace.verifiedRaw, "raw");
    if (trace.read.size > 2 && wikiPages.length + rawSources.length === 0)
      throw new Error("Character Mind query result is not grounded in its reads");
    return { briefing, wikiPages, rawSources } satisfies CharacterMindQueryResult;
  }
  const summary = typeof value.summary === "string" ? value.summary.trim() : "";
  if (!summary) throw new Error("Character Mind lint result has no summary");
  const moved = [...trace.moved].flatMap((entry) => entry.split(" -> "));
  return {
    summary,
    findings: strings(value.findings),
    changed: [...new Set([...trace.created, ...trace.updated, ...trace.deleted, ...moved])],
  } satisfies CharacterMindLintResult;
}

export async function runCharacterMindOperation(input: {
  root: string;
  operation: RuntimeOperation;
  value?: string;
  runtime: CharacterMindRuntime;
  signal: AbortSignal;
}): Promise<{
  result: CharacterMindIngestResult | CharacterMindQueryResult | CharacterMindLintResult;
  trace: CharacterMindTrace;
}> {
  const trace = createCharacterMindTrace();
  const toolContext = createCharacterMindTools(input.root, input.operation, trace);
  const messages: ChatMessage[] = [
    {
      role: "system",
      content: `${characterMindPrompt(input.operation, input.value)}${input.runtime.prompt ? `\n\nADDITIONAL USER-CONFIGURED AGENT GUIDANCE:\n${input.runtime.prompt}` : ""}`,
      contextKind: "prompt",
    },
  ];
  let finalContent = "";
  try {
    await withLlmRequestTimeout(CHARACTER_MIND_OPERATION_TIMEOUT_MS, async () => {
      for (let round = 0; round < CHARACTER_MIND_MAX_TOOL_ROUNDS[input.operation]; round += 1) {
        const response = await input.runtime.provider.chatComplete(messages, {
          model: input.runtime.model,
          temperature: 0.2,
          maxTokens: CHARACTER_MIND_MAX_OUTPUT_TOKENS[input.operation],
          tools: toolContext.tools,
          stream: false,
          enableCaching: input.runtime.enableCaching,
          signal: input.signal,
        });
        if (!response.toolCalls.length) {
          finalContent = response.content?.trim() ?? "";
          break;
        }
        messages.push({
          role: "assistant",
          content: response.content ?? "",
          tool_calls: response.toolCalls,
          ...(response.providerMetadata ? { providerMetadata: response.providerMetadata } : {}),
        });
        for (const call of response.toolCalls) {
          let content: string;
          try {
            content = await toolContext.execute(call);
          } catch (error) {
            content = JSON.stringify({ error: error instanceof Error ? error.message : "Tool failed" });
          }
          messages.push({ role: "tool", content, tool_call_id: call.id });
        }
      }
      if (!finalContent) {
        const response = await input.runtime.provider.chatComplete(messages, {
          model: input.runtime.model,
          temperature: 0.2,
          maxTokens: CHARACTER_MIND_MAX_OUTPUT_TOKENS[input.operation],
          stream: false,
          enableCaching: input.runtime.enableCaching,
          signal: input.signal,
        });
        finalContent = response.content?.trim() ?? "";
      }
    });
    if (!trace.read.has("SCHEMA.md") || !trace.read.has("index.md"))
      throw new Error("Character Mind operation did not read SCHEMA.md and index.md");
    if (input.operation === "ingest" && input.value && !trace.read.has(input.value))
      throw new Error("Character Mind ingest did not read its raw source");
    if (input.operation === "lint") {
      const wikiPages = (await listMarkdown(input.root, "wiki")).filter((path) => path.startsWith("wiki/"));
      if (!trace.listed.some((path) => path === "wiki" || path === ""))
        throw new Error("Character Mind lint did not list the wiki");
      if (wikiPages.some((path) => !trace.read.has(path)))
        throw new Error("Character Mind lint did not read the complete wiki");
    }
    return { result: validateResult(input.operation, parseObject(finalContent), trace), trace };
  } catch (error) {
    if (error && typeof error === "object") Object.assign(error, { characterMindTrace: trace });
    throw error;
  }
}
