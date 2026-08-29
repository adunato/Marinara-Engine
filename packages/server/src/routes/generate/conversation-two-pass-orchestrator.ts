import {
  CONVERSATION_CONTEXT_SOURCE_KEYS,
  normalizeConversationContextSourceRoles,
  type ConversationContextSourceKey,
} from "@marinara-engine/shared";
import type { ChatMessage, LLMUsage } from "../../services/llm/base-provider.js";
import {
  assembleConversationBriefingArtifact,
  buildConversationBriefingMetadataPatch,
  conversationBriefingNeedsFullBuild,
  withConversationBriefingTurnLock,
} from "../../services/generation/conversation-context-briefing-state.js";
import {
  executeConversationBatchedSourceRequest,
  extractConversationContextSources,
  renderConversationAlwaysIncludeSources,
} from "../../services/generation/conversation-context-sources.js";
import {
  buildConversationBriefingUpdateMessages,
  buildConversationFastPathMessages,
  buildConversationSourceRequestMessages,
  conversationPromptHash,
  normalizeConversationBriefing,
  parseConversationFastPathDecision,
  parseConversationSourceRequest,
} from "./conversation-two-pass-runtime.js";

export interface ConversationCompletionResult {
  content: string;
  input: ChatMessage[];
  provider: string;
  model: string;
  maxTokens: number;
  durationMs: number;
  usage?: LLMUsage;
}

export interface ConversationTwoPassDiagnostics {
  provider: string;
  model: string;
  maxTokens: number;
  durationMs: number;
  usage?: LLMUsage;
  sourceHash: string;
  input: Array<{ role: string; content: string }>;
  briefing: string;
  path: "fast" | "full" | "forced_full";
  revision: number;
  classifierInput?: Array<{ role: string; content: string }> | null;
  classifierResult?: { fastPath: boolean; reason: string } | null;
  sourceRequest?: unknown;
  sourceResults?: string | null;
  contributingSources: ConversationContextSourceKey[];
}

function buildTurnDelta(messages: readonly ChatMessage[]): string {
  const turns = messages
    .filter((message) => message.role === "user" || message.role === "assistant")
    .filter((message) => message.content.trim())
    .slice(-3);
  return turns.map((message) => `${message.role.toUpperCase()}: ${message.content}`).join("\n\n") || "(No text turn delta.)";
}

export async function prepareConversationTurnBriefing(args: {
  chatId: string;
  metadata: Record<string, unknown>;
  preparedMessages: readonly ChatMessage[];
  sourceScaffold: string;
  sourceOverrides?: ReadonlyMap<
    ConversationContextSourceKey,
    import("../../services/generation/conversation-context-sources.js").ConversationResolvedSource
  >;
  curatorPrompt: string;
  fastPathPrompt: string;
  maxOutputTokens: number;
  completeClassifier(messages: ChatMessage[]): Promise<ConversationCompletionResult>;
  completeCurator(messages: ChatMessage[]): Promise<ConversationCompletionResult>;
  persistMetadata(patch: Record<string, unknown>): Promise<void>;
  dynamicCuratedSourceKeys?: readonly ConversationContextSourceKey[];
  resolveCuratedSource?: (
    key: ConversationContextSourceKey,
    request: unknown,
  ) => Promise<import("../../services/generation/conversation-context-sources.js").ConversationResolvedSource | null | undefined>;
  now?: Date;
}): Promise<{ artifact: string; images: string[]; files: NonNullable<ChatMessage["files"]>; diagnostics: ConversationTwoPassDiagnostics }> {
  return withConversationBriefingTurnLock(args.chatId, async () => {
    const now = args.now ?? new Date();
    const roles = normalizeConversationContextSourceRoles(args.metadata.conversationContextSourceRoles);
    const sources = extractConversationContextSources(args.preparedMessages, args.sourceScaffold, args.sourceOverrides);
    const availableSources = new Set<ConversationContextSourceKey>([
      ...sources.keys(),
      ...(args.dynamicCuratedSourceKeys ?? []),
    ]);
    const validity = conversationBriefingNeedsFullBuild({ metadata: args.metadata, roles, availableSources, now });
    const alwaysInclude = renderConversationAlwaysIncludeSources(sources, roles);
    const turnDelta = buildTurnDelta(args.preparedMessages);
    const curatedSourceKeys = CONVERSATION_CONTEXT_SOURCE_KEYS.filter(
      (key) => roles[key] === "agent_curated" && availableSources.has(key),
    );

    let path: "fast" | "full" | "forced_full" = validity.required ? "forced_full" : "full";
    let classifierInput: ChatMessage[] | null = null;
    let classifierResult: { fastPath: boolean; reason: string } | null = null;
    if (!validity.required && validity.briefing) {
      classifierInput = buildConversationFastPathMessages({
        prompt: args.fastPathPrompt,
        previousBriefing: validity.briefing,
        turnDelta,
      });
      try {
        const result = await args.completeClassifier(classifierInput);
        classifierResult = parseConversationFastPathDecision(result.content);
        if (classifierResult.fastPath) path = "fast";
      } catch {
        classifierResult = { fastPath: false, reason: "classifier failure; fail-safe full path" };
        path = "full";
      }
    }

    let sourceRequest: unknown = null;
    let sourceResults: string | null = null;
    let returnedKeys: ConversationContextSourceKey[] = [];
    let updateMessages: ChatMessage[];

    if (path === "fast") {
      updateMessages = buildConversationBriefingUpdateMessages({
        curatorPrompt: args.curatorPrompt,
        mode: "fast",
        previousBriefing: validity.briefing,
        sourcesMarkdown: alwaysInclude.markdown,
        turnDelta,
      });
    } else {
      const requestMessages = buildConversationSourceRequestMessages({
        curatorPrompt: args.curatorPrompt,
        previousBriefing: path === "forced_full" ? null : validity.briefing,
        turnDelta,
        curatedSourceKeys,
        forcedFull: path === "forced_full",
      });
      const requestCompletion = await args.completeCurator(requestMessages);
      const request = parseConversationSourceRequest(requestCompletion.content);
      sourceRequest = request;
      const executed = await executeConversationBatchedSourceRequest({
        request,
        sources,
        roles,
        resolveCuratedSource: args.resolveCuratedSource,
      });
      sourceResults = executed.markdown;
      returnedKeys = executed.returnedKeys;
      updateMessages = buildConversationBriefingUpdateMessages({
        curatorPrompt: args.curatorPrompt,
        mode: path,
        previousBriefing: path === "forced_full" ? null : validity.briefing,
        sourcesMarkdown: alwaysInclude.markdown,
        sourceResults,
        turnDelta,
      });
    }

    const completion = await args.completeCurator(updateMessages);
    const briefingBody = normalizeConversationBriefing(completion.content, args.maxOutputTokens);
    const artifact = assembleConversationBriefingArtifact(alwaysInclude.markdown, briefingBody);
    const contributingSources = Array.from(new Set([...alwaysInclude.keys, ...returnedKeys]));
    const patch = buildConversationBriefingMetadataPatch({
      metadata: args.metadata,
      artifact,
      contributingSources,
      now,
    });
    await args.persistMetadata(patch);
    const state = patch.conversationContextBriefingState as { revision: number };

    return {
      artifact,
      images: alwaysInclude.images,
      files: alwaysInclude.files,
      diagnostics: {
        provider: completion.provider,
        model: completion.model,
        maxTokens: completion.maxTokens,
        durationMs: completion.durationMs,
        usage: completion.usage,
        sourceHash: conversationPromptHash(args.preparedMessages),
        input: completion.input.map(({ role, content }) => ({ role, content })),
        briefing: artifact,
        path,
        revision: state.revision,
        classifierInput: classifierInput?.map(({ role, content }) => ({ role, content })) ?? null,
        classifierResult,
        sourceRequest,
        sourceResults,
        contributingSources,
      },
    };
  });
}
