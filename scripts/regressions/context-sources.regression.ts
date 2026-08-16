import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { createFileNativeDB } from "../../packages/server/src/db/file-backed-store.js";
import { buildRoleplayContextSourcesBlock } from "../../packages/server/src/routes/generate/roleplay-context-sources.js";
import { createChatsStorage } from "../../packages/server/src/services/storage/chats.storage.js";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const generateRouteSource = readFileSync(
  join(repositoryRoot, "packages/server/src/routes/generate.routes.ts"),
  "utf8",
).replace(/\r\n/gu, "\n");
const contextSourcesGateStart = generateRouteSource.indexOf('if (chatMode === "roleplay") {');
const contextSourcesGateEnd = generateRouteSource.indexOf("const noodlePromptContext", contextSourcesGateStart);
assert.notEqual(contextSourcesGateStart, -1, "Roleplay Source Chats gate must remain in the generation route");
assert.notEqual(contextSourcesGateEnd, -1, "Roleplay Source Chats gate must precede the noodle prompt context");
const contextSourcesGateSource = generateRouteSource.slice(contextSourcesGateStart, contextSourcesGateEnd);
assert.match(
  contextSourcesGateSource,
  /if \(chatMode === "roleplay"\) \{[\s\S]{0,180}buildRoleplayContextSourcesBlock/u,
  "Roleplay Source Chats must be included for active Scenes as well as ordinary Roleplays",
);
assert.doesNotMatch(
  contextSourcesGateSource,
  /!isSceneChat/u,
  "Scene generation must not gate explicitly selected Source Chats",
);

const contextBlockWithoutSummaryMemories = await buildRoleplayContextSourcesBlock({
  chatId: "target",
  chats: {
    async listContextSources() {
      return [{ sourceChatId: "conversation-source" }];
    },
    async getById() {
      return {
        id: "conversation-source",
        name: "Conversation Source",
        mode: "conversation",
        characterIds: [],
        metadata: {
          includeConversationSummaryMemoriesInPrompt: false,
          weekSummaries: {
            "06.07.2026": {
              summary: "EXCLUDED_MEMORY_WEEK_SUMMARY_INCLUDED",
              keyDetails: ["EXCLUDED_WEEK_DETAIL"],
            },
          },
          daySummaries: {
            "14.07.2026": {
              summary: "EXCLUDED_MEMORY_DAY_SUMMARY_INCLUDED",
              keyDetails: ["EXCLUDED_DAY_DETAIL"],
            },
          },
        },
      };
    },
    async listMessages() {
      return [];
    },
  },
  characters: {
    async getById() {
      return null;
    },
  },
  gameStateStore: {
    async getLatestCommitted() {
      return null;
    },
    async getLatest() {
      return null;
    },
  },
});
assert.match(contextBlockWithoutSummaryMemories ?? "", /EXCLUDED_MEMORY_WEEK_SUMMARY_INCLUDED/u);
assert.match(contextBlockWithoutSummaryMemories ?? "", /EXCLUDED_MEMORY_DAY_SUMMARY_INCLUDED/u);
assert.doesNotMatch(contextBlockWithoutSummaryMemories ?? "", /EXCLUDED_WEEK_DETAIL/u);
assert.doesNotMatch(contextBlockWithoutSummaryMemories ?? "", /EXCLUDED_DAY_DETAIL/u);

const storageDir = mkdtempSync(join(tmpdir(), "marinara-context-sources-"));
process.env.FILE_STORAGE_DIR = storageDir;

try {
  const db = await createFileNativeDB();
  const storage = createChatsStorage(db);
  const createChat = (name: string, mode: "conversation" | "roleplay" | "game") =>
    storage.create({
      name,
      mode,
      characterIds: [],
      groupId: null,
      personaId: null,
      promptPresetId: null,
      connectionId: null,
    });

  const target = await createChat("Target Roleplay", "roleplay");
  const conversation = await createChat("Conversation Source", "conversation");
  const roleplay = await createChat("Roleplay Source", "roleplay");
  const game = await createChat("Game Source", "game");
  assert.ok(target && conversation && roleplay && game);

  await storage.replaceContextSources(target.id, [conversation.id, game.id]);
  assert.deepEqual(
    (await storage.listContextSources(target.id)).map((source) => source.sourceChatId),
    [conversation.id, game.id],
  );

  await storage.replaceContextSources(target.id, [roleplay.id]);
  assert.deepEqual(
    (await storage.listContextSources(target.id)).map((source) => source.sourceChatId),
    [roleplay.id],
  );

  await storage.remove(roleplay.id);
  assert.deepEqual(await storage.listContextSources(target.id), []);

  await db._fileStore.close();
  console.info("Roleplay context source storage regression passed.");
} finally {
  rmSync(storageDir, { recursive: true, force: true });
}
