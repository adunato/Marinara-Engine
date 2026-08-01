import { getLLMAttributes, register, SpanStatusCode, trace, type Message, type Tool } from "@arizeai/phoenix-otel";
import { logger } from "../../lib/logger.js";
import {
  BaseLLMProvider,
  type ChatCompletionResult,
  type ChatMessage,
  type ChatOptions,
  type LLMUsage,
} from "./base-provider.js";

const TRACER_NAME = "marinara-engine.llm";
const DEFAULT_PROJECT_NAME = "marinara-engine";
const DEFAULT_COLLECTOR_ENDPOINT = "http://localhost:6007";
const MAX_RAW_STREAM_TRACE_CHARS = 4 * 1024 * 1024;

let phoenixTracer: ReturnType<typeof trace.getTracer> | null = null;
let phoenixRegistrationAttempted = false;

function isEnabled(value: string | undefined): boolean {
  return value === "1" || value?.toLowerCase() === "true";
}

export function isPhoenixLlmTracingEnabled(): boolean {
  return isEnabled(process.env.PHOENIX_LLM_TRACING_ENABLED);
}

function getPhoenixTracer(): ReturnType<typeof trace.getTracer> | null {
  if (phoenixTracer || phoenixRegistrationAttempted) return phoenixTracer;
  phoenixRegistrationAttempted = true;

  try {
    const endpoint = process.env.PHOENIX_COLLECTOR_ENDPOINT?.trim() || DEFAULT_COLLECTOR_ENDPOINT;
    const projectName = process.env.PHOENIX_PROJECT?.trim() || DEFAULT_PROJECT_NAME;
    register({ projectName, url: endpoint, batch: false });
    phoenixTracer = trace.getTracer(TRACER_NAME);
    logger.info({ endpoint, projectName }, "[llm-tracing] Phoenix tracing enabled");
  } catch (error) {
    logger.warn(error, "[llm-tracing] Could not initialize Phoenix; LLM tracing is disabled");
  }

  return phoenixTracer;
}

function toTraceMessage(message: ChatMessage): Message {
  const attachmentSummary = [
    message.images?.length ? `${message.images.length} image(s)` : null,
    message.files?.length ? `${message.files.length} file(s)` : null,
    message.media?.length ? `${message.media.length} media attachment(s)` : null,
  ].filter(Boolean);
  const content = attachmentSummary.length
    ? `${message.content}\n\n[Attachments omitted from trace: ${attachmentSummary.join(", ")}]`
    : message.content;

  return {
    role: message.role,
    content,
    ...(message.tool_call_id ? { toolCallId: message.tool_call_id } : {}),
    ...(message.tool_calls?.length
      ? {
          toolCalls: message.tool_calls.map((call) => ({
            id: call.id,
            function: { name: call.function.name, arguments: call.function.arguments },
          })),
        }
      : {}),
  };
}

function toTraceTools(options: ChatOptions): Tool[] | undefined {
  if (!options.tools?.length) return undefined;
  return options.tools.map((tool) => ({
    jsonSchema: {
      type: tool.type,
      function: {
        name: tool.function.name,
        description: tool.function.description,
        parameters: tool.function.parameters,
      },
    },
  }));
}

function invocationParameters(options: ChatOptions): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries({
      temperature: options.temperature,
      maxTokens: options.maxTokens,
      maxContext: options.maxContext,
      topP: options.topP,
      topK: options.topK,
      minP: options.minP,
      frequencyPenalty: options.frequencyPenalty,
      presencePenalty: options.presencePenalty,
      stream: options.stream ?? Boolean(options.onToken),
      stop: options.stop,
      enableCaching: options.enableCaching,
      anthropicExtendedCacheTtl: options.anthropicExtendedCacheTtl,
      cachingAtDepth: options.cachingAtDepth,
      captureReasoning: options.captureReasoning,
      enableThinking: options.enableThinking,
      reasoningEffort: options.reasoningEffort,
      excludePastReasoning: options.excludePastReasoning,
      verbosity: options.verbosity,
      serviceTier: options.serviceTier,
      openrouterProvider: options.openrouterProvider,
      responseFormat: options.responseFormat,
      customParameters: options.customParameters,
      enabledParameters: options.enabledParameters,
      suppressModelParameters: options.suppressModelParameters,
      forceTextualToolCalls: options.forceTextualToolCalls,
    }).filter(([, value]) => value !== undefined),
  );
}

type RawStreamSummary = {
  dataEvents: number;
  doneReceived: boolean;
  invalidJsonEvents: number;
  contentCharacters: number;
  toolCallChunks: number;
  toolArgumentCharacters: number;
  messageToolCalls: number;
  finishReason?: string;
};

function recordContentCharacters(value: unknown): number {
  if (typeof value === "string") return value.length;
  if (!Array.isArray(value)) return 0;
  return value.reduce((total, item) => {
    if (typeof item === "string") return total + item.length;
    if (!item || typeof item !== "object") return total;
    const record = item as Record<string, unknown>;
    return total + (typeof record.text === "string" ? record.text.length : 0);
  }, 0);
}

function toolArgumentCharacters(value: unknown): number {
  if (typeof value === "string") return value.length;
  if (value === undefined || value === null) return 0;
  try {
    return JSON.stringify(value)?.length ?? 0;
  } catch {
    return 0;
  }
}

export function summarizeRawOpenAiStream(raw: string): RawStreamSummary {
  const summary: RawStreamSummary = {
    dataEvents: 0,
    doneReceived: false,
    invalidJsonEvents: 0,
    contentCharacters: 0,
    toolCallChunks: 0,
    toolArgumentCharacters: 0,
    messageToolCalls: 0,
  };

  for (const line of raw.split(/\r?\n/u)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("data:")) continue;
    const payload = trimmed.slice(5).trimStart();
    summary.dataEvents += 1;
    if (payload === "[DONE]") {
      summary.doneReceived = true;
      continue;
    }

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(payload) as Record<string, unknown>;
    } catch {
      summary.invalidJsonEvents += 1;
      continue;
    }

    if (!Array.isArray(parsed.choices)) continue;
    for (const rawChoice of parsed.choices) {
      if (!rawChoice || typeof rawChoice !== "object") continue;
      const choice = rawChoice as Record<string, unknown>;
      if (typeof choice.finish_reason === "string") summary.finishReason = choice.finish_reason;

      for (const [kind, value] of [
        ["delta", choice.delta],
        ["message", choice.message],
      ] as const) {
        if (!value || typeof value !== "object" || Array.isArray(value)) continue;
        const part = value as Record<string, unknown>;
        summary.contentCharacters += recordContentCharacters(part.content);
        if (!Array.isArray(part.tool_calls)) continue;
        if (kind === "delta") summary.toolCallChunks += part.tool_calls.length;
        else summary.messageToolCalls += part.tool_calls.length;
        for (const rawToolCall of part.tool_calls) {
          if (!rawToolCall || typeof rawToolCall !== "object") continue;
          const toolCall = rawToolCall as Record<string, unknown>;
          const fn =
            toolCall.function && typeof toolCall.function === "object" && !Array.isArray(toolCall.function)
              ? (toolCall.function as Record<string, unknown>)
              : toolCall;
          summary.toolArgumentCharacters += toolArgumentCharacters(
            fn.arguments ?? fn.parameters ?? toolCall.arguments ?? toolCall.parameters,
          );
        }
      }
    }
  }

  return summary;
}

function createRawStreamCapture(options: ChatOptions) {
  if (!(options.stream ?? Boolean(options.onToken))) return null;
  const startedAt = Date.now();
  const originalObserver = options.onRawStreamChunk;
  let rawResponse = "";
  let rawCharacters = 0;
  let networkChunks = 0;
  let firstChunkMs: number | undefined;
  let truncated = false;

  return {
    options: {
      ...options,
      onRawStreamChunk: (chunk: string) => {
        networkChunks += 1;
        rawCharacters += chunk.length;
        firstChunkMs ??= Date.now() - startedAt;
        const remaining = MAX_RAW_STREAM_TRACE_CHARS - rawResponse.length;
        if (remaining > 0) rawResponse += chunk.slice(0, remaining);
        if (chunk.length > remaining) truncated = true;
        originalObserver?.(chunk);
      },
    } satisfies ChatOptions,
    record(span: NonNullable<ReturnType<typeof startLlmSpan>>) {
      const summary = summarizeRawOpenAiStream(rawResponse);
      span.setAttributes({
        "llm.stream.raw_response": rawResponse,
        "llm.stream.raw_character_count": rawCharacters,
        "llm.stream.network_chunk_count": networkChunks,
        "llm.stream.raw_response_truncated": truncated,
        "llm.stream.capture_limit_chars": MAX_RAW_STREAM_TRACE_CHARS,
        "llm.stream.sse_data_event_count": summary.dataEvents,
        "llm.stream.sse_done_received": summary.doneReceived,
        "llm.stream.invalid_json_event_count": summary.invalidJsonEvents,
        "llm.stream.content_character_count": summary.contentCharacters,
        "llm.stream.tool_call_chunk_count": summary.toolCallChunks,
        "llm.stream.tool_argument_character_count": summary.toolArgumentCharacters,
        "llm.stream.message_tool_call_count": summary.messageToolCalls,
        ...(firstChunkMs !== undefined ? { "llm.stream.first_chunk_ms": firstChunkMs } : {}),
        ...(summary.finishReason ? { "llm.stream.provider_finish_reason": summary.finishReason } : {}),
      });
    },
  };
}

function startLlmSpan(providerName: string, messages: ChatMessage[], options: ChatOptions) {
  const tracer = getPhoenixTracer();
  if (!tracer) return null;

  try {
    const span = tracer.startSpan(`${providerName}.chat`);
    span.setAttribute("openinference.span.kind", "LLM");
    span.setAttributes(
      getLLMAttributes({
        provider: providerName,
        modelName: options.model,
        invocationParameters: invocationParameters(options),
        inputMessages: messages.map(toTraceMessage),
        tools: toTraceTools(options),
      }),
    );
    return span;
  } catch (error) {
    logger.warn(error, "[llm-tracing] Could not start Phoenix span; continuing without a trace");
    return null;
  }
}

function recordResult(
  span: NonNullable<ReturnType<typeof startLlmSpan>>,
  providerName: string,
  model: string,
  result: ChatCompletionResult,
): void {
  try {
    span.setAttributes(
      getLLMAttributes({
        provider: providerName,
        modelName: model,
        outputMessages: [
          {
            role: "assistant",
            content: result.content ?? "",
            ...(result.toolCalls.length
              ? {
                  toolCalls: result.toolCalls.map((call) => ({
                    id: call.id,
                    function: { name: call.function.name, arguments: call.function.arguments },
                  })),
                }
              : {}),
          },
        ],
        tokenCount: result.usage
          ? {
              prompt: result.usage.promptTokens,
              completion: result.usage.completionTokens,
              total: result.usage.totalTokens,
              promptDetails: {
                cacheRead: result.usage.cachedPromptTokens,
                cacheWrite: result.usage.cacheWritePromptTokens,
              },
            }
          : undefined,
      }),
    );
    span.setAttribute("llm.output.finish_reason", result.finishReason);
    if (result.usage?.completionReasoningTokens !== undefined) {
      span.setAttribute("llm.token_count.completion_reasoning", result.usage.completionReasoningTokens);
    }
    span.setStatus({ code: SpanStatusCode.OK });
  } catch (error) {
    logger.warn(error, "[llm-tracing] Could not record Phoenix result attributes");
  }
}

function recordError(span: NonNullable<ReturnType<typeof startLlmSpan>>, error: unknown): void {
  try {
    const message = error instanceof Error ? error.message : String(error);
    span.recordException(error instanceof Error ? error : message);
    span.setStatus({ code: SpanStatusCode.ERROR, message });
  } catch (traceError) {
    logger.warn(traceError, "[llm-tracing] Could not record Phoenix error attributes");
  }
}

function endSpan(span: NonNullable<ReturnType<typeof startLlmSpan>>): void {
  try {
    span.end();
  } catch (error) {
    logger.warn(error, "[llm-tracing] Could not finish Phoenix span");
  }
}

/**
 * Decorates a configured provider with opt-in OpenInference traces for Phoenix.
 * Binary attachment bodies and provider-native replay metadata are deliberately omitted.
 */
class PhoenixTracingProvider extends BaseLLMProvider {
  constructor(
    private readonly providerName: string,
    private readonly provider: BaseLLMProvider,
  ) {
    super("", "");
  }

  override get maxTokensOverrideValue(): number | null {
    return this.provider.maxTokensOverrideValue;
  }

  override get maxContextValue(): number | null {
    return this.provider.maxContextValue;
  }

  async *chat(messages: ChatMessage[], options: ChatOptions): AsyncGenerator<string, LLMUsage | void, unknown> {
    const span = startLlmSpan(this.providerName, messages, options);
    if (!span) return yield* this.provider.chat(messages, options);

    const generation = this.provider.chat(messages, options);
    let content = "";
    let completed = false;
    try {
      while (true) {
        const next = await generation.next();
        if (next.done) {
          completed = true;
          recordResult(span, this.providerName, options.model, {
            content,
            toolCalls: [],
            finishReason: next.value?.finishReason ?? "stop",
            usage: next.value || undefined,
          });
          return next.value;
        }
        content += next.value;
        yield next.value;
      }
    } catch (error) {
      recordError(span, error);
      throw error;
    } finally {
      if (!completed) {
        try {
          await generation.return?.();
        } catch {
          // Preserve the original stream outcome; the provider owns cleanup details.
        }
        try {
          span.setAttribute("llm.stream.cancelled", true);
          if (content) {
            span.setAttributes(getLLMAttributes({ outputMessages: [{ role: "assistant", content }] }));
          }
        } catch (error) {
          logger.warn(error, "[llm-tracing] Could not record cancelled Phoenix stream");
        }
      }
      endSpan(span);
    }
  }

  override async chatComplete(messages: ChatMessage[], options: ChatOptions): Promise<ChatCompletionResult> {
    const span = startLlmSpan(this.providerName, messages, options);
    if (!span) return this.provider.chatComplete(messages, options);
    const rawStreamCapture = createRawStreamCapture(options);

    try {
      const result = await this.provider.chatComplete(messages, rawStreamCapture?.options ?? options);
      recordResult(span, this.providerName, options.model, result);
      return result;
    } catch (error) {
      recordError(span, error);
      throw error;
    } finally {
      try {
        rawStreamCapture?.record(span);
      } catch (error) {
        logger.warn(error, "[llm-tracing] Could not record raw Phoenix stream");
      }
      endSpan(span);
    }
  }

  override embed(texts: string[], model: string, signal?: AbortSignal): Promise<number[][]> {
    return this.provider.embed(texts, model, signal);
  }
}

export function withPhoenixLlmTracing(provider: BaseLLMProvider, providerName: string): BaseLLMProvider {
  if (!isPhoenixLlmTracingEnabled()) return provider;
  return new PhoenixTracingProvider(providerName, provider);
}
