// ──────────────────────────────────────────────
// Routes: Chat Folders
// ──────────────────────────────────────────────
import type { FastifyInstance } from "fastify";
import { createChatFolderSchema, moveChatToFolderSchema, reorderChatsInFolderSchema } from "@marinara-engine/shared";
import { createChatFoldersStorage } from "../services/storage/chat-folders.storage.js";
import { createChatsStorage } from "../services/storage/chats.storage.js";
import { createUserProfilesStorage } from "../services/storage/user-profiles.storage.js";
import { registerFolderCrudRoutes } from "./folder-routes.shared.js";

export async function chatFoldersRoutes(app: FastifyInstance) {
  const storage = createChatFoldersStorage(app.db);
  const chatsStorage = createChatsStorage(app.db);
  const profilesStorage = createUserProfilesStorage(app.db);

  registerFolderCrudRoutes(app, createChatFolderSchema, storage, {
    async resolveProfileId(req, reply) {
      const profileId = typeof (req.query as { profileId?: unknown }).profileId === "string"
        ? (req.query as { profileId: string }).profileId.trim()
        : "";
      if (!profileId || !(await profilesStorage.getById(profileId))) {
        reply.status(400).send({ error: "A valid profileId is required" });
        return null;
      }
      return profileId;
    },
    async validateCreate(input, profileId, reply) {
      if (input.profileId !== profileId) {
        reply.status(400).send({ error: "Chat folder profileId must match the active profile" });
        return false;
      }
      return true;
    },
    ownsFolder(folder, profileId) {
      return folder.profileId === profileId;
    },
  });

  // ── Move a chat into (or out of) a folder ──
  app.post("/move-chat", async (req, reply) => {
    const { chatId, folderId } = moveChatToFolderSchema.parse(req.body);
    // Validate folder exists if non-null
    if (folderId) {
      const folder = await storage.getById(folderId);
      if (!folder) return reply.status(404).send({ error: "Folder not found" });
      const chat = await chatsStorage.getById(chatId);
      // Cross-profile moves are not supported (CR038): a chat can only be filed
      // into folders that live on the same profile as the chat itself.
      if (chat && chat.profileId !== folder.profileId) {
        return reply.status(400).send({ error: "Cannot move a chat to a folder in another profile" });
      }
    }
    // Propagate the folder to every branch in the group so later branch
    // creation/deletion doesn't drop the tree back into Uncategorized.
    const chat = await chatsStorage.setFolderForChat(chatId, folderId);
    return reply.send(chat);
  });

  // ── Reorder chats within a folder (or root) ──
  app.post("/reorder-chats", async (req, reply) => {
    const { orderedChatIds, folderId } = reorderChatsInFolderSchema.parse(req.body);
    // Cross-profile reorders are not supported (CR038): when targeting a folder,
    // every reordered chat must already live on that folder's profile. Root
    // reorders keep each chat on its own profile and need no guard.
    if (folderId) {
      const folder = await storage.getById(folderId);
      if (!folder) return reply.status(404).send({ error: "Folder not found" });
      for (const orderedChatId of orderedChatIds) {
        const chat = await chatsStorage.getById(orderedChatId);
        if (chat && chat.profileId !== folder.profileId) {
          return reply.status(400).send({ error: "Cannot reorder a chat into a folder in another profile" });
        }
      }
    }

    // Atomic: a partial failure mid-loop would leave chats with a mix of
    // old and new sort_order / folder_id values across siblings of the
    // same group. Chats-per-folder counts are O(dozens), well under the
    // threshold for an excessively large single storage operation.
    await app.db.transaction(async (tx) => {
      for (let i = 0; i < orderedChatIds.length; i++) {
        const id = orderedChatIds[i]!;
        // Update sortOrder on the visible representative chat, then propagate
        // the folder assignment to its sibling branches.
        await chatsStorage.update(id, { sortOrder: i + 1 }, { tx });
        await chatsStorage.setFolderForChat(id, folderId, { tx });
      }
    });
    return reply.send({ ok: true });
  });
}
