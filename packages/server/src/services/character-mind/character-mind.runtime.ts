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
  CHARACTER_MIND_REQUEST_TIMEOUT_MS,
  characterMindPrompt,
} from "./character-mind.constants.js";
import { normalizeMindPath } from "./character-mind.files.js";
import {
  createCharacterMindTools,
  createCharacterMindTrace,
  validateWikiPageCandidate,
  type CharacterMindTrace,
} from "./character-mind.tools.js";
import type { CharacterMindCandidateSet } from "./character-mind.candidate.js";
import { validateCharacterMindChangePlan, type CharacterMindChangePlan } from "./character-mind.plan.js";

type RuntimeOperation = "plan" | "build-page" | "ingest" | "query" | "lint" | "write-page" | "write-index" | "edit";

export interface CharacterMindMarkdownResult {
  content: string;
  summary: string;
}

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
    if (!/^wiki\/[^/]+\.md$/i.test(path))
      throw new Error(`Character Mind plan page path is not flat wiki Markdown: ${path}`);
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

async function characterMindPageCandidateError(
  root: string,
  content: string,
  trace: CharacterMindTrace,
  target: { path: string; sources: string[]; mustRead?: boolean },
  options: { exactSources: boolean; knownWikiPaths: string[] },
): Promise<string | null> {
  const unread = [
    ...(!trace.read.has("SCHEMA.md") ? ["SCHEMA.md"] : []),
    ...(!trace.read.has("index.md") ? ["index.md"] : []),
    ...(target.mustRead && !trace.read.has(target.path) ? [target.path] : []),
    ...target.sources.filter((path) => !trace.verifiedRaw.has(path)),
  ];
  if (unread.length > 0)
    return `The page candidate was not accepted because these required files were not successfully read: ${[
      ...new Set(unread),
    ].join(", ")}`;
  try {
    if (!content || /^```/u.test(content)) throw new Error("Return raw Markdown without a code fence");
    const knownPaths = new Set(options.knownWikiPaths.map((path) => path.toLowerCase()));
    await validateWikiPageCandidate(root, target.path, content, {
      knownPaths,
      verifiedRaw: trace.verifiedRaw,
      ...(options.exactSources ? { requiredSources: new Set(target.sources) } : {}),
    });
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : "The page candidate is invalid";
  }
}

function validateJsonResult(
  operation: RuntimeOperation,
  value: Record<string, unknown>,
  trace: CharacterMindTrace,
  sourcePaths: string[],
) {
  if (operation === "plan") return validateCharacterMindPlanResult(value, trace, sourcePaths);
  if (operation === "edit") {
    const summary = typeof value.summary === "string" ? value.summary.trim() : "";
    if (!summary) throw new Error("Character Mind edit result has no summary");
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
  page?: CharacterMindPagePlan;
  target?: { path: string; sources: string[]; mustRead?: boolean };
  knownWikiPaths?: string[];
  candidate?: CharacterMindCandidateSet;
  runtime: CharacterMindRuntime;
  signal: AbortSignal;
}): Promise<{
  result:
    | CharacterMindPlanResult
    | CharacterMindIngestResult
    | CharacterMindQueryResult
    | CharacterMindLintResult
    | CharacterMindChangePlan
    | CharacterMindMarkdownResult;
  trace: CharacterMindTrace;
}> {
  if (input.operation === "build-page" && (!input.plan || !input.page))
    throw new Error("Character Mind page build requires its frozen map and target page");
  if ((input.operation === "write-page" || input.operation === "edit") && !input.target)
    throw new Error(`Character Mind ${input.operation} requires a bound target`);
  if (input.operation === "edit" && !input.candidate)
    throw new Error("Character Mind edit requires a temporary candidate set");
  const trace = createCharacterMindTrace();
  const sourcePaths = input.sourcePaths ?? [];
  const toolContext = createCharacterMindTools(input.root, input.operation, trace, {
    candidate: input.candidate,
    editablePaths: input.target ? [input.target.path] : undefined,
  });
  const preloadedResult = JSON.parse(
    await toolContext.execute({
      id: "marinara-required-files",
      type: "function",
      function: {
        name: "mind_read_markdown",
        arguments: JSON.stringify({ reads: [{ path: "SCHEMA.md" }, { path: "index.md" }] }),
      },
    }),
  ) as { reads?: Array<{ path?: unknown; content?: unknown }> };
  const preloadedMarkdown = (preloadedResult.reads ?? [])
    .filter(
      (read): read is { path: string; content: string } =>
        typeof read.path === "string" && typeof read.content === "string",
    )
    .map((read) => `--- BEGIN ${read.path} ---\n${read.content}\n--- END ${read.path} ---`)
    .join("\n\n");
  const messages: ChatMessage[] = [
    {
      role: "system",
      content: `${characterMindPrompt(input.operation, input.value)}\n\nMANDATORY MARKDOWN FILES PRELOADED BY MARINARA:\n${preloadedMarkdown}${input.runtime.prompt ? `\n\nADDITIONAL USER-CONFIGURED AGENT GUIDANCE:\n${input.runtime.prompt}` : ""}`,
      contextKind: "prompt",
    },
  ];
  let finalContent = "";
  const toolFailures: string[] = [];
  let unresolvedEditFailure: string | null = null;
  const streamedMarkdown = ["build-page", "write-page", "write-index"].includes(input.operation);
  const complete = (allowTools = true) =>
    withLlmRequestTimeout(CHARACTER_MIND_REQUEST_TIMEOUT_MS, () =>
      input.runtime.provider.chatComplete(messages, {
        model: input.runtime.model,
        temperature: 0.2,
        maxTokens: input.runtime.maxTokens,
        ...(allowTools ? { tools: toolContext.tools } : {}),
        stream: streamedMarkdown,
        enableCaching: input.runtime.enableCaching,
        signal: AbortSignal.any([input.signal, AbortSignal.timeout(CHARACTER_MIND_REQUEST_TIMEOUT_MS)]),
      }),
    );
  try {
    for (let round = 0; round < CHARACTER_MIND_MAX_TOOL_ROUNDS[input.operation]; round += 1) {
      const response = await complete();
      if (!response.toolCalls.length) {
        const candidateContent = response.content?.trim() ?? "";
        let validationError: string | null = null;
        if (input.operation === "plan") {
          validationError = characterMindPlanCandidateError(candidateContent, trace, sourcePaths);
        }
        const markdownTarget = input.operation === "build-page" ? input.page : input.target;
        if ((input.operation === "build-page" || input.operation === "write-page") && markdownTarget) {
          validationError = await characterMindPageCandidateError(input.root, candidateContent, trace, markdownTarget, {
            exactSources: input.operation === "build-page",
            knownWikiPaths: input.knownWikiPaths ?? input.plan?.pages.map((page) => page.path) ?? [markdownTarget.path],
          });
        }
        if (input.operation === "write-index") {
          if (!candidateContent || /^```/u.test(candidateContent))
            validationError = "Return raw Markdown without a code fence";
          else if (Buffer.byteLength(candidateContent, "utf8") > 128 * 1024)
            validationError = "index.md exceeds 128 KiB";
          else if (!/^#\s+\S.+$/mu.test(candidateContent)) validationError = "index.md must contain an H1";
        }
        if (input.operation === "ingest" || input.operation === "lint") {
          try {
            await validateCharacterMindChangePlan(
              input.root,
              parseObject(candidateContent),
              trace,
              input.operation,
              input.operation === "ingest" ? input.value : undefined,
            );
          } catch (error) {
            validationError = error instanceof Error ? error.message : "The change plan is invalid";
          }
        }
        if (input.operation === "edit" && input.target) {
          try {
            if (unresolvedEditFailure) throw new Error(`Last candidate edit failed: ${unresolvedEditFailure}`);
            if (input.target.mustRead && !trace.read.has(input.target.path))
              throw new Error(`Character Mind editor did not read: ${input.target.path}`);
            const unread = input.target.sources.filter((path) => !trace.verifiedRaw.has(path));
            if (unread.length) throw new Error(`Character Mind editor did not read: ${unread.join(", ")}`);
            if (!trace.updated.has(input.target.path))
              throw new Error(`Character Mind editor did not edit its target: ${input.target.path}`);
            validateJsonResult("edit", parseObject(candidateContent), trace, []);
          } catch (error) {
            validationError = error instanceof Error ? error.message : "The edit result is invalid";
          }
        }
        if (validationError) {
          messages.push({
            role: "assistant",
            content: response.content ?? "",
            ...(response.providerMetadata ? { providerMetadata: response.providerMetadata } : {}),
          });
          messages.push({
            role: "user",
            content: `MARINARA VALIDATION REJECTED THIS CANDIDATE:\n${validationError}\n\nContinue the same operation. Correct the failed reads, edits, or result, then return a complete replacement that satisfies the original contract.`,
            contextKind: "prompt",
          });
          continue;
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
          if (call.function.name === "mind_edit_candidate") unresolvedEditFailure = null;
        } catch (error) {
          const message = error instanceof Error ? error.message : "Tool failed";
          const failure = `${call.function.name}: ${message}`;
          toolFailures.push(failure);
          if (call.function.name === "mind_edit_candidate") unresolvedEditFailure = failure;
          content = JSON.stringify({ error: message });
        }
        messages.push({ role: "tool", content, tool_call_id: call.id });
      }
    }
    if (!finalContent) throw new Error(`Character Mind ${input.operation} exceeded its correction limit`);
    if (!trace.read.has("SCHEMA.md") || !trace.read.has("index.md"))
      throw new Error("Character Mind operation did not read SCHEMA.md and index.md");
    try {
      if (streamedMarkdown) {
        const targetPath = input.operation === "build-page" ? input.page!.path : (input.target?.path ?? "index.md");
        return {
          result: {
            content: finalContent,
            summary: `${input.operation === "write-index" ? "Replaced" : "Prepared"} ${targetPath}`,
          },
          trace,
        };
      }
      if (input.operation === "ingest" || input.operation === "lint") {
        return {
          result: await validateCharacterMindChangePlan(
            input.root,
            parseObject(finalContent),
            trace,
            input.operation,
            input.operation === "ingest" ? input.value : undefined,
          ),
          trace,
        };
      }
      return { result: validateJsonResult(input.operation, parseObject(finalContent), trace, sourcePaths), trace };
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
