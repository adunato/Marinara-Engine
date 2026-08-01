import { AsyncLocalStorage } from "node:async_hooks";
import { logger } from "../../lib/logger.js";
import type { ChatCompletionResult, ChatMessage, ChatOptions, LLMUsage } from "./base-provider.js";
import { BaseLLMProvider } from "./base-provider.js";

const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_BASE_DELAY_MS = 250;
const DEFAULT_MAX_DELAY_MS = 2_000;
const DEFAULT_MAX_RETRY_AFTER_MS = 10_000;

const TRANSIENT_STATUS_CODES = new Set([408, 429, 502, 503, 504]);
const TRANSIENT_ERROR_CODES = new Set([
  "EAI_AGAIN",
  "ECONNRESET",
  "ECONNREFUSED",
  "EHOSTUNREACH",
  "ENETDOWN",
  "ENETUNREACH",
  "ENOTFOUND",
  "EPIPE",
  "ETIMEDOUT",
  "UND_ERR_BODY_TIMEOUT",
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_HEADERS_TIMEOUT",
  "UND_ERR_SOCKET",
]);
const TRANSIENT_PROVIDER_STATUSES = new Set([
  "DEADLINE_EXCEEDED",
  "OVERLOADED",
  "RESOURCE_EXHAUSTED",
  "TOO_MANY_REQUESTS",
  "UNAVAILABLE",
]);

type ErrorRecord = Record<string, unknown>;

export type LlmTransportRetryClassification = {
  retryable: boolean;
  reason: string;
  retryAfterMs?: number;
};

export type LlmTransportRetryOptions = {
  maxAttempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  maxRetryAfterMs?: number;
  random?: () => number;
  sleep?: (delayMs: number, signal?: AbortSignal) => Promise<void>;
};

type ResolvedRetryOptions = Required<Omit<LlmTransportRetryOptions, "sleep">> & {
  sleep: (delayMs: number, signal?: AbortSignal) => Promise<void>;
};

type RetryOperationContext = {
  reportedFallbacks: Set<string>;
};

const retryOperationContext = new AsyncLocalStorage<RetryOperationContext>();

/** Report a fallback activation once for the complete retry-aware request operation. */
export function claimLlmFallbackNotification(key: string): boolean {
  const context = retryOperationContext.getStore();
  if (!context) return true;
  if (context.reportedFallbacks.has(key)) return false;
  context.reportedFallbacks.add(key);
  return true;
}

function isRecord(value: unknown): value is ErrorRecord {
  return !!value && typeof value === "object";
}

function normalizePositiveInteger(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

function abortReason(signal?: AbortSignal): unknown {
  if (!signal?.aborted) return null;
  if (signal.reason !== undefined && signal.reason !== null) return signal.reason;
  return new DOMException("The operation was aborted", "AbortError");
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw abortReason(signal);
}

async function abortAwareSleep(delayMs: number, signal?: AbortSignal): Promise<void> {
  throwIfAborted(signal);
  if (delayMs <= 0) return;

  await new Promise<void>((resolve, reject) => {
    const cleanup = () => signal?.removeEventListener("abort", onAbort);
    const timer = setTimeout(() => {
      cleanup();
      resolve();
    }, delayMs);
    const onAbort = () => {
      clearTimeout(timer);
      cleanup();
      reject(abortReason(signal));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function errorChain(error: unknown): unknown[] {
  const chain: unknown[] = [];
  const pending = [error];
  const seen = new Set<unknown>();
  while (pending.length > 0) {
    const current = pending.shift();
    if (current === undefined || seen.has(current)) continue;
    seen.add(current);
    chain.push(current);
    if (!isRecord(current)) continue;
    if (current.cause !== undefined) pending.push(current.cause);
    if (Array.isArray(current.errors)) pending.push(...current.errors);
  }
  return chain;
}

function numericStatus(value: unknown): number | null {
  if (typeof value === "number" && Number.isInteger(value)) return value;
  if (typeof value === "string" && /^\d{3}$/u.test(value.trim())) return Number(value);
  return null;
}

function statusFromRecord(record: ErrorRecord): number | null {
  for (const value of [record.status, record.statusCode, record.httpStatus]) {
    const status = numericStatus(value);
    if (status !== null) return status;
  }
  if (isRecord(record.response)) return numericStatus(record.response.status);
  return null;
}

function headersFromRecord(record: ErrorRecord): unknown {
  if (record.headers !== undefined) return record.headers;
  return isRecord(record.response) ? record.response.headers : undefined;
}

function headerValue(headers: unknown, name: string): string | null {
  if (!headers) return null;
  if (isRecord(headers) && typeof headers.get === "function") {
    const value = (headers.get as (headerName: string) => unknown)(name);
    return typeof value === "string" ? value : null;
  }
  if (!isRecord(headers)) return null;
  const entry = Object.entries(headers).find(([key]) => key.toLowerCase() === name.toLowerCase());
  if (!entry) return null;
  const value = entry[1];
  return typeof value === "string" || typeof value === "number" ? String(value) : null;
}

function parseRetryAfterMs(value: string | null, now = Date.now()): number | null {
  if (!value?.trim()) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.round(seconds * 1_000);
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? Math.max(0, timestamp - now) : null;
}

function retryAfterFromRecord(record: ErrorRecord): number | null {
  for (const value of [record.retryAfterMs, record.retry_after_ms]) {
    if (typeof value === "number" && Number.isFinite(value) && value >= 0) return Math.round(value);
  }
  if (typeof record.retryAfter === "string") return parseRetryAfterMs(record.retryAfter);
  const headers = headersFromRecord(record);
  const milliseconds = headerValue(headers, "retry-after-ms");
  if (milliseconds !== null && Number.isFinite(Number(milliseconds)) && Number(milliseconds) >= 0) {
    return Math.round(Number(milliseconds));
  }
  return parseRetryAfterMs(headerValue(headers, "retry-after"));
}

function messageFor(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  if (isRecord(error) && typeof error.message === "string") return error.message;
  return "";
}

function explicitHttpStatus(message: string): number | null {
  const match = message.match(
    /(?:api\s+error|http(?:\s+error)?|request\s+failed|response\s+failed|status)[^\d]{0,20}(408|429|502|503|504)\b|\((408|429|502|503|504)\)/iu,
  );
  return match ? Number(match[1] ?? match[2]) : null;
}

export function classifyLlmTransportError(error: unknown, signal?: AbortSignal): LlmTransportRetryClassification {
  if (signal?.aborted) return { retryable: false, reason: "aborted" };

  const chain = errorChain(error);
  for (const item of chain) {
    if (!isRecord(item)) continue;
    const status = statusFromRecord(item);
    if (status !== null) {
      return TRANSIENT_STATUS_CODES.has(status)
        ? { retryable: true, reason: `http_${status}`, retryAfterMs: retryAfterFromRecord(item) ?? undefined }
        : { retryable: false, reason: `http_${status}` };
    }
  }

  for (const item of chain) {
    if (!isRecord(item)) continue;
    const code = typeof item.code === "string" ? item.code.toUpperCase() : "";
    if (TRANSIENT_ERROR_CODES.has(code)) return { retryable: true, reason: code.toLowerCase() };
    const status = typeof item.status === "string" ? item.status.toUpperCase() : "";
    if (TRANSIENT_PROVIDER_STATUSES.has(status)) return { retryable: true, reason: status.toLowerCase() };
  }

  for (const item of chain) {
    const message = messageFor(item);
    const status = explicitHttpStatus(message);
    if (status !== null) return { retryable: true, reason: `http_${status}` };
  }

  const combinedMessage = chain.map(messageFor).filter(Boolean).join(" | ").toLowerCase();
  if (
    /\b(fetch failed|network error|socket hang up|connection reset|temporarily unavailable|service unavailable|gateway timeout|request timed? out|timeout|rate limit(?:ed)?|too many requests|overloaded|provider overload|resource[_ ]exhausted|deadline[_ ]exceeded)\b/u.test(
      combinedMessage,
    )
  ) {
    return { retryable: true, reason: "transient_message" };
  }

  return { retryable: false, reason: "permanent_or_unknown" };
}

export class LlmTransportRetryExhaustedError extends Error {
  readonly attempts: number;

  constructor(attempts: number, cause: unknown) {
    const detail = messageFor(cause) || String(cause);
    super(`LLM request failed after ${attempts} attempts: ${detail}`, { cause });
    this.name = "LlmTransportRetryExhaustedError";
    this.attempts = attempts;
  }
}

function resolveOptions(options: LlmTransportRetryOptions): ResolvedRetryOptions {
  return {
    maxAttempts: normalizePositiveInteger(options.maxAttempts, DEFAULT_MAX_ATTEMPTS),
    baseDelayMs: normalizePositiveInteger(options.baseDelayMs, DEFAULT_BASE_DELAY_MS),
    maxDelayMs: normalizePositiveInteger(options.maxDelayMs, DEFAULT_MAX_DELAY_MS),
    maxRetryAfterMs: normalizePositiveInteger(options.maxRetryAfterMs, DEFAULT_MAX_RETRY_AFTER_MS),
    random: options.random ?? Math.random,
    sleep: options.sleep ?? abortAwareSleep,
  };
}

function retryDelayMs(
  retryNumber: number,
  classification: LlmTransportRetryClassification,
  options: ResolvedRetryOptions,
): number {
  const exponential = Math.min(options.maxDelayMs, options.baseDelayMs * 2 ** Math.max(0, retryNumber - 1));
  const jittered = Math.round(exponential * (0.75 + Math.min(1, Math.max(0, options.random())) * 0.5));
  const retryAfter = Math.min(options.maxRetryAfterMs, classification.retryAfterMs ?? 0);
  return Math.max(jittered, retryAfter);
}

function observedOptions(options: ChatOptions, markObserved: () => void): ChatOptions {
  if (
    !options.onToken &&
    !options.onThinking &&
    !options.onResponseParts &&
    !options.onEncryptedReasoning &&
    !options.onChatCompletionsReasoning
  ) {
    return options;
  }

  return {
    ...options,
    ...(options.onToken
      ? {
          onToken: async (chunk: string) => {
            if (chunk.trim().length > 0) markObserved();
            await options.onToken?.(chunk);
          },
        }
      : {}),
    ...(options.onThinking
      ? {
          onThinking: (chunk: string) => {
            if (chunk.length > 0) markObserved();
            options.onThinking?.(chunk);
          },
        }
      : {}),
    ...(options.onResponseParts
      ? {
          onResponseParts: (parts: unknown[]) => {
            if (parts.length > 0) markObserved();
            options.onResponseParts?.(parts);
          },
        }
      : {}),
    ...(options.onEncryptedReasoning
      ? {
          onEncryptedReasoning: (items: unknown[]) => {
            if (items.length > 0) markObserved();
            options.onEncryptedReasoning?.(items);
          },
        }
      : {}),
    ...(options.onChatCompletionsReasoning
      ? {
          onChatCompletionsReasoning: (metadata: Record<string, unknown>) => {
            if (Object.keys(metadata).length > 0) markObserved();
            options.onChatCompletionsReasoning?.(metadata);
          },
        }
      : {}),
  };
}

export class LlmTransportRetryProvider extends BaseLLMProvider {
  private readonly retryOptions: ResolvedRetryOptions;

  constructor(
    private readonly provider: BaseLLMProvider,
    options: LlmTransportRetryOptions = {},
  ) {
    super("", "", provider.maxContextValue ?? undefined, null, provider.maxTokensOverrideValue);
    this.retryOptions = resolveOptions(options);
  }

  get wrappedProvider(): BaseLLMProvider {
    return this.provider;
  }

  private async waitForRetry(
    attempt: number,
    classification: LlmTransportRetryClassification,
    options: ChatOptions,
    error: unknown,
  ): Promise<void> {
    const retryNumber = attempt;
    const delayMs = retryDelayMs(retryNumber, classification, this.retryOptions);
    logger.warn(
      error,
      "[llm-retry] Transient request failure for model %s; retry %d/%d in %dms (%s)",
      options.model,
      retryNumber,
      this.retryOptions.maxAttempts - 1,
      delayMs,
      classification.reason,
    );
    await this.retryOptions.sleep(delayMs, options.signal);
  }

  async *chat(messages: ChatMessage[], options: ChatOptions): AsyncGenerator<string, LLMUsage | void, unknown> {
    let responseObserved = false;
    const reportedFallbacks = new Set<string>();
    const attemptOptions = observedOptions(options, () => {
      responseObserved = true;
    });

    for (let attempt = 1; attempt <= this.retryOptions.maxAttempts; attempt += 1) {
      throwIfAborted(options.signal);
      responseObserved = false;
      try {
        const generation = this.provider.chat(messages, attemptOptions);
        const context = { reportedFallbacks };
        let result = await retryOperationContext.run(context, () => generation.next());
        while (!result.done) {
          responseObserved ||= result.value.trim().length > 0;
          yield result.value;
          result = await retryOperationContext.run(context, () => generation.next());
        }
        return result.value;
      } catch (error) {
        if (responseObserved || options.signal?.aborted) throw error;
        const classification = classifyLlmTransportError(error, options.signal);
        if (!classification.retryable) throw error;
        if (attempt >= this.retryOptions.maxAttempts) {
          throw new LlmTransportRetryExhaustedError(attempt, error);
        }
        await this.waitForRetry(attempt, classification, options, error);
      }
    }
  }

  override async chatComplete(messages: ChatMessage[], options: ChatOptions): Promise<ChatCompletionResult> {
    let responseObserved = false;
    const reportedFallbacks = new Set<string>();
    const attemptOptions = observedOptions(options, () => {
      responseObserved = true;
    });

    for (let attempt = 1; attempt <= this.retryOptions.maxAttempts; attempt += 1) {
      throwIfAborted(options.signal);
      responseObserved = false;
      try {
        return await retryOperationContext.run({ reportedFallbacks }, () =>
          this.provider.chatComplete(messages, attemptOptions),
        );
      } catch (error) {
        if (responseObserved || options.signal?.aborted) throw error;
        const classification = classifyLlmTransportError(error, options.signal);
        if (!classification.retryable) throw error;
        if (attempt >= this.retryOptions.maxAttempts) {
          throw new LlmTransportRetryExhaustedError(attempt, error);
        }
        await this.waitForRetry(attempt, classification, options, error);
      }
    }

    throw new Error("Unreachable LLM retry state");
  }

  override embed(texts: string[], model: string, signal?: AbortSignal): Promise<number[][]> {
    return this.provider.embed(texts, model, signal);
  }
}

export function withLlmTransportRetries(
  provider: BaseLLMProvider,
  options: LlmTransportRetryOptions = {},
): BaseLLMProvider {
  return provider instanceof LlmTransportRetryProvider ? provider : new LlmTransportRetryProvider(provider, options);
}

export function unwrapLlmTransportRetries(provider: BaseLLMProvider): BaseLLMProvider {
  return provider instanceof LlmTransportRetryProvider ? provider.wrappedProvider : provider;
}
