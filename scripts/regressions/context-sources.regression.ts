import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createFileNativeDB } from "../../packages/server/src/db/file-backed-store.js";
import { createChatsStorage } from "../../packages/server/src/services/storage/chats.storage.js";

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
