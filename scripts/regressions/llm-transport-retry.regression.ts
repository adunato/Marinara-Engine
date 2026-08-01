import assert from "node:assert/strict";

import {
  BaseLLMProvider,
  LLMHttpError,
  type ChatCompletionResult,
  type ChatMessage,
  type ChatOptions,
  type LLMUsage,
} from "../../packages/server/src/services/llm/base-provider.js";
import {
  ConnectionFallbackProvider,
  withConnectionFallbackProvider,
  type FallbackConnection,
} from "../../packages/server/src/services/llm/connection-fallback-provider.js";
import { createLLMProvider } from "../../packages/server/src/services/llm/provider-registry.js";
import {
  classifyLlmTransportError,
  LlmTransportRetryExhaustedError,
  LlmTransportRetryProvider,
  withLlmTransportRetries,
} from "../../packages/server/src/services/llm/transport-retry-provider.js";

const successResult: ChatCompletionResult = {
  content: "completed",
  toolCalls: [],
  finishReason: "stop",
};

class ScriptedCompletionProvider extends BaseLLMProvider {
  readonly calls: Array<{ messages: ChatMessage[]; options: ChatOptions }> = [];

  constructor(private readonly outcomes: Array<ChatCompletionResult | Error>) {
    super("", "");
  }

  async *chat(): AsyncGenerator<string, LLMUsage | void, unknown> {
    throw new Error("chat() was not expected");
  }

  override async chatComplete(messages: ChatMessage[], options: ChatOptions): Promise<ChatCompletionResult> {
    this.calls.push({ messages, options });
    const outcome = this.outcomes[Math.min(this.calls.length - 1, this.outcomes.length - 1)];
    if (outcome instanceof Error) throw outcome;
    return outcome;
  }
}

class ScriptedStreamingProvider extends BaseLLMProvider {
  calls = 0;

  constructor(private readonly outcomes: Array<string[] | Error>) {
    super("", "");
  }

  async *chat(): AsyncGenerator<string, LLMUsage | void, unknown> {
    const outcome = this.outcomes[Math.min(this.calls, this.outcomes.length - 1)];
    this.calls += 1;
    if (outcome instanceof Error) throw outcome;
    for (const chunk of outcome) yield chunk;
  }
}

function transportFailure(message = "fetch failed"): Error {
  return new TypeError(message, { cause: Object.assign(new Error("socket closed"), { code: "ECONNRESET" }) });
}

function retryProvider(provider: BaseLLMProvider, delays: number[] = []): LlmTransportRetryProvider {
  return new LlmTransportRetryProvider(provider, {
    baseDelayMs: 1,
    maxDelayMs: 1,
    random: () => 0.5,
    sleep: async (delayMs) => {
      delays.push(delayMs);
    },
  });
}

assert.deepEqual(classifyLlmTransportError(transportFailure()), {
  retryable: true,
  reason: "econnreset",
});
assert.equal(classifyLlmTransportError(Object.assign(new Error("unauthorized"), { status: 401 })).retryable, false);
assert.equal(classifyLlmTransportError(new Error("OpenAI API error 503: overloaded")).retryable, true);
assert.equal(classifyLlmTransportError(new Error("context limit exceeded")).retryable, false);

const messages: ChatMessage[] = [
  {
    role: "assistant",
    content: "",
    tool_calls: [{ id: "read-1", type: "function", function: { name: "read", arguments: "{}" } }],
  },
  { role: "tool", tool_call_id: "read-1", content: "previous tool result" },
  { role: "user", content: "continue" },
];
const options: ChatOptions = { model: "test-model", temperature: 0.4, customParameters: { stable: true } };
const retryThenSuccess = new ScriptedCompletionProvider([transportFailure(), successResult]);
const retryDelays: number[] = [];
assert.equal((await retryProvider(retryThenSuccess, retryDelays).chatComplete(messages, options)).content, "completed");
assert.equal(retryThenSuccess.calls.length, 2);
assert.equal(retryThenSuccess.calls[0]?.messages, messages);
assert.equal(retryThenSuccess.calls[1]?.messages, messages);
assert.equal(retryThenSuccess.calls[0]?.options, options);
assert.equal(retryThenSuccess.calls[1]?.options, options);
assert.deepEqual(messages[1], { role: "tool", tool_call_id: "read-1", content: "previous tool result" });
assert.deepEqual(retryDelays, [1]);

const immediateSuccess = new ScriptedCompletionProvider([successResult]);
const immediateDelays: number[] = [];
await retryProvider(immediateSuccess, immediateDelays).chatComplete(messages, options);
assert.equal(immediateSuccess.calls.length, 1);
assert.deepEqual(immediateDelays, []);

const preAbortController = new AbortController();
preAbortController.abort(null);
const preAbortProvider = new ScriptedCompletionProvider([successResult]);
await assert.rejects(
  retryProvider(preAbortProvider).chatComplete(messages, { ...options, signal: preAbortController.signal }),
  (error: unknown) => error instanceof DOMException && error.name === "AbortError",
);
assert.equal(preAbortProvider.calls.length, 0);

const permanentFailure = new ScriptedCompletionProvider([
  Object.assign(new Error("OpenAI API error 401: invalid key"), { status: 401 }),
]);
await assert.rejects(retryProvider(permanentFailure).chatComplete(messages, options), /invalid key/u);
assert.equal(permanentFailure.calls.length, 1);

const exhaustedProvider = new ScriptedCompletionProvider([transportFailure("request timed out")]);
const exhaustedError = await retryProvider(exhaustedProvider)
  .chatComplete(messages, options)
  .then(
    () => null,
    (error: unknown) => error,
  );
assert.ok(exhaustedError instanceof LlmTransportRetryExhaustedError);
assert.equal(exhaustedError.attempts, 3);
assert.match(exhaustedError.message, /request timed out/u);
assert.ok(exhaustedError.cause instanceof Error);
assert.equal(exhaustedProvider.calls.length, 3);

const retryAfterFailure = new LLMHttpError(
  "rate limited",
  new Response(null, { status: 429, headers: { "retry-after": "5" } }),
);
const retryAfterProvider = new ScriptedCompletionProvider([retryAfterFailure, successResult]);
const retryAfterDelays: number[] = [];
await new LlmTransportRetryProvider(retryAfterProvider, {
  baseDelayMs: 1,
  maxDelayMs: 1,
  maxRetryAfterMs: 1_000,
  random: () => 0.5,
  sleep: async (delayMs) => {
    retryAfterDelays.push(delayMs);
  },
}).chatComplete(messages, options);
assert.deepEqual(retryAfterDelays, [1_000]);

const backoffAbortController = new AbortController();
const backoffAbortReason = new DOMException("user cancelled backoff", "AbortError");
const backoffAbortProvider = new ScriptedCompletionProvider([transportFailure()]);
await assert.rejects(
  new LlmTransportRetryProvider(backoffAbortProvider, {
    sleep: async (_delayMs, signal) => {
      backoffAbortController.abort(backoffAbortReason);
      signal?.throwIfAborted();
    },
  }).chatComplete(messages, { ...options, signal: backoffAbortController.signal }),
  (error: unknown) => error === backoffAbortReason,
);
assert.equal(backoffAbortProvider.calls.length, 1);

const inFlightAbortController = new AbortController();
const inFlightAbortReason = new DOMException("user cancelled request", "AbortError");
class InFlightAbortProvider extends BaseLLMProvider {
  calls = 0;

  async *chat(): AsyncGenerator<string, LLMUsage | void, unknown> {
    throw new Error("chat() was not expected");
  }

  override chatComplete(_messages: ChatMessage[], chatOptions: ChatOptions): Promise<ChatCompletionResult> {
    this.calls += 1;
    return new Promise((_resolve, reject) => {
      chatOptions.signal?.addEventListener("abort", () => reject(chatOptions.signal?.reason), { once: true });
      queueMicrotask(() => inFlightAbortController.abort(inFlightAbortReason));
    });
  }
}
const inFlightAbortProvider = new InFlightAbortProvider();
await assert.rejects(
  retryProvider(inFlightAbortProvider).chatComplete(messages, { ...options, signal: inFlightAbortController.signal }),
  (error: unknown) => error === inFlightAbortReason,
);
assert.equal(inFlightAbortProvider.calls, 1);

const streamingRetry = new ScriptedStreamingProvider([transportFailure(), ["recovered"]]);
let streamed = "";
for await (const chunk of retryProvider(streamingRetry).chat(messages, options)) streamed += chunk;
assert.equal(streamed, "recovered");
assert.equal(streamingRetry.calls, 2);

class PartialStreamingFailureProvider extends BaseLLMProvider {
  calls = 0;

  async *chat(): AsyncGenerator<string, LLMUsage | void, unknown> {
    this.calls += 1;
    yield "visible";
    throw transportFailure("failure after visible stream output");
  }
}
const partialStream = new PartialStreamingFailureProvider();
let partialOutput = "";
await assert.rejects(async () => {
  for await (const chunk of retryProvider(partialStream).chat(messages, options)) partialOutput += chunk;
}, /visible stream output/u);
assert.equal(partialOutput, "visible");
assert.equal(partialStream.calls, 1);

const callbackFailure = new ScriptedCompletionProvider([transportFailure()]);
let callbackCalls = 0;
callbackFailure.chatComplete = async (_messages, callbackOptions) => {
  callbackFailure.calls.push({ messages, options: callbackOptions });
  await callbackOptions.onToken?.("visible");
  throw transportFailure("failure after visible callback output");
};
await assert.rejects(
  retryProvider(callbackFailure).chatComplete(messages, {
    ...options,
    onToken: () => {
      callbackCalls += 1;
    },
  }),
  /visible callback output/u,
);
assert.equal(callbackFailure.calls.length, 1);
assert.equal(callbackCalls, 1);

assert.ok(createLLMProvider("custom", "https://example.com/v1", "test") instanceof LlmTransportRetryProvider);
const alreadyWrapped = retryProvider(immediateSuccess);
assert.equal(withLlmTransportRetries(alreadyWrapped), alreadyWrapped);

const fallbackConnection: FallbackConnection = {
  id: "fallback",
  name: "Fallback",
  provider: "custom",
  baseUrl: "https://fallback.example/v1",
  apiKey: "test",
  model: "fallback-model",
};
const fallbackAware = withConnectionFallbackProvider({
  primary: retryProvider(new ScriptedCompletionProvider([successResult])),
  primaryConnectionId: "primary",
  fallbackConnection,
  fallbackBaseUrl: fallbackConnection.baseUrl!,
  category: "main",
});
assert.ok(fallbackAware instanceof LlmTransportRetryProvider);
assert.ok(fallbackAware.wrappedProvider instanceof ConnectionFallbackProvider);

const boundaryPrimary = new ScriptedCompletionProvider([transportFailure("primary transport failed")]);
const boundaryFallback = new ScriptedCompletionProvider([transportFailure("fallback transport failed")]);
let fallbackNotifications = 0;
const retryAwareFallback = retryProvider(
  new ConnectionFallbackProvider(boundaryPrimary, boundaryFallback, fallbackConnection, "main", async () => {
    fallbackNotifications += 1;
  }),
);
await assert.rejects(retryAwareFallback.chatComplete(messages, options), LlmTransportRetryExhaustedError);
assert.equal(boundaryPrimary.calls.length, 3, "the primary should run once per complete retry attempt");
assert.equal(boundaryFallback.calls.length, 3, "the fallback should run once per complete retry attempt");
assert.equal(fallbackNotifications, 1, "fallback activation should be reported once for the logical request");

process.stdout.write("LLM transport retry regression passed.\n");
