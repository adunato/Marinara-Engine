import { jsonrepair } from "jsonrepair";
import {
  CHARACTER_MIND_AGENT_ID,
  isAgentConfigDeleted,
  parseAgentSettingsRecord,
  type CharacterMindIngestResult,
  type CharacterMindLintResult,
  type CharacterMindPagePlan,
  type CharacterMindPlanResult,
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
  CHARACTER_MIND_MAX_TOOL_ROUNDS,
  CHARACTER_MIND_OPERATION_TIMEOUT_MS,
  characterMindPrompt,
} from "./character-mind.constants.js";
import { listMarkdown, normalizeMindPath } from "./character-mind.files.js";
import { createCharacterMindTools, createCharacterMindTrace, type CharacterMindTrace } from "./character-mind.tools.js";

type RuntimeOperation = "plan" | "build" | "ingest" | "query" | "lint";
type MutationTarget = "index" | "wiki";

export interface CharacterMindRuntime {
  provider: BaseLLMProvider;
  model: string;
  prompt: string;
  enableCaching: boolean;
  maxTokens: number;
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
  const configuredMaxTokens = Number(parseAgentSettingsRecord(config.settings).maxTokens);
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
    maxTokens: Number.isFinite(configuredMaxTokens)
      ? Math.max(256, Math.min(32_768, Math.floor(configuredMaxTokens)))
      : 4096,
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

function mutationTarget(toolName: string): MutationTarget | null {
  if (/write/i.test(toolName) && /index/i.test(toolName)) return "index";
  return /write|move|delete/i.test(toolName) ? "wiki" : null;
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`Character Mind plan ${field} is required`);
  return value.trim();
}

export function validateCharacterMindPlanResult(
  value: Record<string, unknown>,
  trace: CharacterMindTrace,
  sourcePaths: string[],
): CharacterMindPlanResult {
  const summary = requiredString(value.summary, "summary");
  if (!Array.isArray(value.pages) || value.pages.length < 1 || value.pages.length > 100)
    throw new Error("Character Mind plan must contain 1 to 100 pages");
  const allowedSources = new Set(sourcePaths);
  const seenPages = new Set<string>();
  const usedSources = new Set<string>();
  const pages: CharacterMindPagePlan[] = value.pages.map((candidate, index) => {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate))
      throw new Error(`Character Mind plan page ${index + 1} is invalid`);
    const item = candidate as Record<string, unknown>;
    const path = normalizeMindPath(requiredString(item.path, `page ${index + 1} path`));
    if (!/^wiki\/[^/]+\.md$/i.test(path)) throw new Error(`Character Mind plan page path is not flat wiki Markdown: ${path}`);
    if (seenPages.has(path.toLowerCase())) throw new Error(`Character Mind plan contains duplicate page: ${path}`);
    seenPages.add(path.toLowerCase());
    const requestedSources = strings(item.sources);
    const sources = groundedPaths(item.sources, allowedSources, "raw");
    if (requestedSources.length !== sources.length)
      throw new Error(`Character Mind plan page has duplicate, unknown, or invalid sources: ${path}`);
    if (sources.length === 0) throw new Error(`Character Mind plan page has no valid sources: ${path}`);
    for (const source of sources) usedSources.add(source);
    return {
      path,
      title: requiredString(item.title, `page ${path} title`),
      purpose: requiredString(item.purpose, `page ${path} purpose`),
      sources,
    };
  });
  const excludedSources: CharacterMindPlanResult["excludedSources"] = [];
  if (value.excludedSources !== undefined && !Array.isArray(value.excludedSources))
    throw new Error("Character Mind plan excludedSources must be an array");
  const excludedCandidates = Array.isArray(value.excludedSources) ? value.excludedSources : [];
  const excludedPaths = new Set<string>();
  for (const [index, candidate] of excludedCandidates.entries()) {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate))
      throw new Error(`Character Mind excluded source ${index + 1} is invalid`);
    const item = candidate as Record<string, unknown>;
    const path = normalizeMindPath(requiredString(item.path, `excluded source ${index + 1} path`));
    if (!allowedSources.has(path)) throw new Error(`Character Mind plan excluded an unknown source: ${path}`);
    if (usedSources.has(path)) throw new Error(`Character Mind plan both used and excluded source: ${path}`);
    if (excludedPaths.has(path)) throw new Error(`Character Mind plan excluded a source more than once: ${path}`);
    excludedPaths.add(path);
    excludedSources.push({ path, reason: requiredString(item.reason, `excluded source ${path} reason`) });
  }
  const accounted = new Set([...usedSources, ...excludedSources.map((item) => item.path)]);
  const missing = sourcePaths.filter((path) => !accounted.has(path));
  if (missing.length) throw new Error(`Character Mind plan did not account for sources: ${missing.join(", ")}`);
  const unread = sourcePaths.filter((path) => !trace.verifiedRaw.has(path));
  if (unread.length) throw new Error(`Character Mind planner did not read sources: ${unread.join(", ")}`);
  return { summary, pages, excludedSources };
}

function characterMindPlanCandidateError(
  content: string,
  trace: CharacterMindTrace,
  sourcePaths: string[],
): string | null {
  const unread = [
    ...(!trace.read.has("SCHEMA.md") ? ["SCHEMA.md"] : []),
    ...(!trace.read.has("index.md") ? ["index.md"] : []),
    ...sourcePaths.filter((path) => !trace.verifiedRaw.has(path)),
  ];
  if (unread.length > 0)
    return `The candidate map was not accepted because these required files were not successfully read: ${[
      ...new Set(unread),
    ].join(", ")}`;
  try {
    validateCharacterMindPlanResult(parseObject(content), trace, sourcePaths);
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : "The candidate map is invalid";
  }
}

function validateResult(
  operation: RuntimeOperation,
  value: Record<string, unknown>,
  trace: CharacterMindTrace,
  sourcePaths: string[],
) {
  if (operation === "plan") return validateCharacterMindPlanResult(value, trace, sourcePaths);
  if (operation === "build" || operation === "ingest") {
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
  sourcePaths?: string[];
  plan?: CharacterMindPlanResult;
  runtime: CharacterMindRuntime;
  signal: AbortSignal;
}): Promise<{
  result: CharacterMindPlanResult | CharacterMindIngestResult | CharacterMindQueryResult | CharacterMindLintResult;
  trace: CharacterMindTrace;
}> {
  const trace = createCharacterMindTrace();
  const sourcePaths = input.sourcePaths ?? [];
  const toolContext = createCharacterMindTools(input.root, input.operation, trace, {
    plannedWikiPaths: input.plan?.pages.map((page) => page.path),
    plannedSourcesByPage: input.plan
      ? Object.fromEntries(input.plan.pages.map((page) => [page.path, page.sources]))
      : undefined,
  });
  const messages: ChatMessage[] = [
    {
      role: "system",
      content: `${characterMindPrompt(input.operation, input.value)}${input.runtime.prompt ? `\n\nADDITIONAL USER-CONFIGURED AGENT GUIDANCE:\n${input.runtime.prompt}` : ""}`,
      contextKind: "prompt",
    },
  ];
  let finalContent = "";
  const toolFailures: string[] = [];
  const unresolvedMutationFailures = new Map<MutationTarget, string>();
  try {
    await withLlmRequestTimeout(CHARACTER_MIND_OPERATION_TIMEOUT_MS, async () => {
      for (let round = 0; round < CHARACTER_MIND_MAX_TOOL_ROUNDS[input.operation]; round += 1) {
        const response = await input.runtime.provider.chatComplete(messages, {
          model: input.runtime.model,
          temperature: 0.2,
          maxTokens: input.runtime.maxTokens,
          tools: toolContext.tools,
          stream: false,
          enableCaching: input.runtime.enableCaching,
          signal: input.signal,
        });
        if (!response.toolCalls.length) {
          const candidateContent = response.content?.trim() ?? "";
          if (input.operation === "plan") {
            const validationError = characterMindPlanCandidateError(candidateContent, trace, sourcePaths);
            if (validationError) {
              messages.push({
                role: "assistant",
                content: response.content ?? "",
                ...(response.providerMetadata ? { providerMetadata: response.providerMetadata } : {}),
              });
              messages.push({
                role: "user",
                content: `MARINARA PLAN VALIDATION REJECTED THIS CANDIDATE:\n${validationError}\n\nContinue the same planning operation. Correct every failed or missing read using the exact manifest paths; mind_read_markdown accepts at most 12 files per call. Then return a complete replacement plan that satisfies the original contract.`,
                contextKind: "prompt",
              });
              continue;
            }
          }
          finalContent = candidateContent;
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
            const target = mutationTarget(call.function.name);
            if (target) unresolvedMutationFailures.delete(target);
          } catch (error) {
            const message = error instanceof Error ? error.message : "Tool failed";
            const failure = `${call.function.name}: ${message}`;
            toolFailures.push(failure);
            const target = mutationTarget(call.function.name);
            if (target) unresolvedMutationFailures.set(target, failure);
            content = JSON.stringify({ error: message });
          }
          messages.push({ role: "tool", content, tool_call_id: call.id });
        }
      }
      if (!finalContent) {
        const response = await input.runtime.provider.chatComplete(messages, {
          model: input.runtime.model,
          temperature: 0.2,
          maxTokens: input.runtime.maxTokens,
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
    if (input.operation === "build" && input.plan) {
      const plannedPaths = new Set(input.plan.pages.map((page) => page.path));
      const requiredSources = [...new Set(input.plan.pages.flatMap((page) => page.sources))];
      const unread = requiredSources.filter((path) => !trace.verifiedRaw.has(path));
      if (unread.length) throw new Error(`Character Mind builder did not read mapped sources: ${unread.join(", ")}`);
      const unwritten = input.plan.pages
        .map((page) => page.path)
        .filter((path) => !trace.created.has(path) && !trace.updated.has(path));
      if (unwritten.length) throw new Error(`Character Mind builder did not write mapped pages: ${unwritten.join(", ")}`);
      const unexpected = [...trace.created, ...trace.updated].filter(
        (path) => path.startsWith("wiki/") && !plannedPaths.has(path),
      );
      if (unexpected.length) throw new Error(`Character Mind builder wrote pages outside the map: ${unexpected.join(", ")}`);
      if (!trace.updated.has("index.md")) throw new Error("Character Mind builder did not finalize index.md");
    }
    if (unresolvedMutationFailures.size > 0)
      throw new Error(
        `Character Mind could not apply its last mutation: ${[...unresolvedMutationFailures.values()].at(-1)}`,
      );
    if (input.operation === "lint") {
      const wikiPages = (await listMarkdown(input.root, "wiki")).filter((path) => path.startsWith("wiki/"));
      if (!trace.listed.some((path) => path === "wiki" || path === ""))
        throw new Error("Character Mind lint did not list the wiki");
      if (wikiPages.some((path) => !trace.read.has(path)))
        throw new Error("Character Mind lint did not read the complete wiki");
    }
    try {
      return { result: validateResult(input.operation, parseObject(finalContent), trace, sourcePaths), trace };
    } catch (error) {
      if (toolFailures.length === 0) throw error;
      const resultError = error instanceof Error ? error.message : "invalid final result";
      throw new Error(`Character Mind final result failed after tool error (${toolFailures.at(-1)}): ${resultError}`);
    }
  } catch (error) {
    if (error && typeof error === "object") Object.assign(error, { characterMindTrace: trace });
    throw error;
  }
}
