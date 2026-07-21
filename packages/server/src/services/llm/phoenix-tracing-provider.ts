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

    try {
      const result = await this.provider.chatComplete(messages, options);
      recordResult(span, this.providerName, options.model, result);
      return result;
    } catch (error) {
      recordError(span, error);
      throw error;
    } finally {
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
