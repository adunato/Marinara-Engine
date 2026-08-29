import assert from "node:assert/strict";
import { createServer } from "node:http";
import {
  DEFAULT_PROFESSOR_MARI_CUSTOM_PROMPT_SETTINGS,
  PROFESSOR_MARI_CUSTOM_PROMPT_MAX_LENGTH,
  normalizeProfessorMariCustomPromptSettings,
  professorMariCustomPromptSettingsSchema,
  type ProfessorMariCustomPromptSettings,
} from "../../packages/shared/src/schemas/app-settings.schema.js";
import { insertProfessorMariCustomPrompt } from "../../packages/server/src/services/professor-mari/workspace-agent.service.js";
import { AnthropicProvider } from "../../packages/server/src/services/llm/providers/anthropic.provider.js";
import { GoogleProvider } from "../../packages/server/src/services/llm/providers/google.provider.js";
import { OpenAIProvider } from "../../packages/server/src/services/llm/providers/openai.provider.js";
import type { ChatMessage } from "../../packages/server/src/services/llm/base-provider.js";

const baseMessages: ChatMessage[] = [
  { role: "system", content: "MARI_SYSTEM_PROMPT", contextKind: "prompt" },
  { role: "system", content: "workspace command protocol", contextKind: "prompt" },
  { role: "user", content: "latest user turn", contextKind: "history" },
  { role: "assistant", content: "previous assistant turn", contextKind: "history" },
];

const roles: ProfessorMariCustomPromptSettings["role"][] = ["system", "user", "assistant"];
for (const role of roles) {
  const settings: ProfessorMariCustomPromptSettings = { enabled: true, role, content: `custom-${role}` };
  const messages = insertProfessorMariCustomPrompt([...baseMessages], settings);
  assert.equal(messages.filter((message) => message.content === settings.content).length, 1);
  assert.deepEqual(messages[1], { role, content: settings.content, contextKind: "prompt" });
  assert.equal(messages[2]?.content, "workspace command protocol");
}

assert.deepEqual(insertProfessorMariCustomPrompt([...baseMessages], DEFAULT_PROFESSOR_MARI_CUSTOM_PROMPT_SETTINGS), baseMessages);
assert.deepEqual(
  insertProfessorMariCustomPrompt([...baseMessages], { enabled: true, role: "system", content: "  \n" }),
  baseMessages,
);
assert.deepEqual(normalizeProfessorMariCustomPromptSettings(null), DEFAULT_PROFESSOR_MARI_CUSTOM_PROMPT_SETTINGS);
assert.deepEqual(normalizeProfessorMariCustomPromptSettings("not-json"), DEFAULT_PROFESSOR_MARI_CUSTOM_PROMPT_SETTINGS);
assert.deepEqual(
  normalizeProfessorMariCustomPromptSettings(JSON.stringify({ enabled: true, role: "user", content: "saved" })),
  { enabled: true, role: "user", content: "saved" },
);
assert.equal(
  professorMariCustomPromptSettingsSchema.safeParse({
    enabled: true,
    role: "system",
    content: "x".repeat(PROFESSOR_MARI_CUSTOM_PROMPT_MAX_LENGTH + 1),
  }).success,
  false,
);

type ProviderCase = {
  name: string;
  create: (baseUrl: string) => { chatComplete: (messages: ChatMessage[], options: { model: string }) => Promise<unknown> };
  path: string;
  response: Record<string, unknown>;
  assertBody: (body: Record<string, unknown>) => void;
};

const providerCases: ProviderCase[] = [
  {
    name: "anthropic",
    create: (baseUrl) => new AnthropicProvider(baseUrl, "test-key"),
    path: "/v1/messages",
    response: { content: [{ type: "text", text: "ok" }], usage: { input_tokens: 1, output_tokens: 1 } },
    assertBody: (body) => {
      assert.equal(typeof body.system, "string");
      assert.match(String(body.system), /custom-system/u);
      assert.ok(Array.isArray(body.messages));
      assert.ok((body.messages as Array<Record<string, unknown>>).every((message) => ["user", "assistant"].includes(String(message.role))));
    },
  },
  {
    name: "google",
    create: (baseUrl) => new GoogleProvider(`${baseUrl}/v1beta`, "test-key"),
    path: "/v1beta/models/gemini-test:generateContent",
    response: { candidates: [{ content: { parts: [{ text: "ok" }] } }] },
    assertBody: (body) => {
      assert.match(JSON.stringify(body.systemInstruction), /custom-system/u);
      assert.ok(Array.isArray(body.contents));
    },
  },
  {
    name: "openai-compatible",
    create: (baseUrl) => new OpenAIProvider(`${baseUrl}/v1`, "test-key", undefined, undefined, undefined, "custom"),
    path: "/v1/chat/completions",
    response: { choices: [{ message: { content: "ok" }, finish_reason: "stop" }] },
    assertBody: (body) => {
      const messages = body.messages as Array<Record<string, unknown>>;
      assert.ok(messages.some((message) => message.role === "system" && message.content === "custom-system"));
      assert.ok(messages.some((message) => message.role === "user"));
      assert.ok(messages.some((message) => message.role === "assistant"));
    },
  },
];

for (const providerCase of providerCases) {
  let receivedBody: Record<string, unknown> | null = null;
  const server = createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    receivedBody = JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>;
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify(providerCase.response));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address();
    assert.ok(address && typeof address === "object");
    const messages = insertProfessorMariCustomPrompt([...baseMessages], {
      enabled: true,
      role: "system",
      content: "custom-system",
    });
    await providerCase.create(`http://127.0.0.1:${address.port}`).chatComplete(messages, { model: "gemini-test" });
    assert.ok(receivedBody, `${providerCase.name} did not receive a request`);
    providerCase.assertBody(receivedBody);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
}

console.log("Professor Mari custom prompt regression checks passed.");
