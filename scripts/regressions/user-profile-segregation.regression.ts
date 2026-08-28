import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { isSameUserProfileOwnership } from "../../packages/shared/src/utils/user-profile-ownership.js";

assert.equal(isSameUserProfileOwnership("a", "a"), true);
assert.equal(isSameUserProfileOwnership("a", "b"), false);
assert.equal(isSameUserProfileOwnership("a", null), false);

const chatsStorage = await readFile(
  new URL("../../packages/server/src/services/storage/chats.storage.ts", import.meta.url),
  "utf8",
);
for (const guard of [
  'assertSameProfile([chatIdA, chatIdB], "connect chats")',
  'assertSameProfile([targetChatId, ...sourceChatIds], "link context sources")',
  'assertSameProfile([sourceChatId, targetChatId], "create influence")',
  'assertSameProfile([sourceChatId, targetChatId], "create conversation note")',
]) {
  assert.ok(chatsStorage.includes(guard), `missing storage ownership guard: ${guard}`);
}

const importer = await readFile(
  new URL("../../packages/server/src/services/import/st-chat.importer.ts", import.meta.url),
  "utf8",
);
assert.ok(
  importer.includes("profileId: opts?.profileId ?? DEFAULT_USER_PROFILE_ID"),
  "chat import target profile is not threaded",
);

const migration = await readFile(
  new URL("../../packages/server/src/db/user-profile-migration.ts", import.meta.url),
  "utf8",
);
assert.ok(migration.includes("validProfileIds"), "migration does not repair dangling profile ownership");
assert.ok(migration.includes("db.transaction"), "profile bootstrap must be transactional");

console.log("user-profile-segregation regression passed");
