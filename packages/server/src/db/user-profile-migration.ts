import { DEFAULT_USER_PROFILE_ID, EMPTY_GAME_SETUP_LEARNED_OPTIONS, EMPTY_GAME_SETUP_REMEMBERED_TEXT } from "@marinara-engine/shared";
import { logger } from "../lib/logger.js";
import type { DB } from "./connection.js";
import { asc, eq } from "./file-query.js";
import { chatFolders, chats } from "./schema/chats.js";
import { personas } from "./schema/characters.js";
import { userProfiles } from "./schema/user-profiles.js";

/**
 * Establishes a valid User Profile ownership boundary for legacy/restored data.
 * Existing distinct profiles are preserved; invalid chat/folder ownership is
 * repaired into Default when available, otherwise the first existing profile.
 */
export async function ensureUserProfilesInitialized(db: DB): Promise<boolean> {
  return db.transaction(async (tx) => {
    let changed = false;
    let profiles = await tx.select().from(userProfiles).orderBy(asc(userProfiles.createdAt), asc(userProfiles.id));
    let repairProfile = profiles.find((profile) => profile.id === DEFAULT_USER_PROFILE_ID) ?? profiles[0];

    if (!repairProfile) {
      const activePersona = await tx
        .select({ id: personas.id })
        .from(personas)
        .where(eq(personas.isActive, "true"))
        .orderBy(asc(personas.createdAt), asc(personas.id))
        .limit(1);
      const timestamp = new Date().toISOString();
      await tx.insert(userProfiles).values({
        id: DEFAULT_USER_PROFILE_ID,
        name: "Default",
        activePersonaId: activePersona[0]?.id ?? null,
        lastActiveMode: null,
        lastActiveChatByMode: "{}",
        userStatusManual: "active",
        userStatus: "active",
        userActivity: "",
        recentUserActivities: "[]",
        learnedGameSetupOptions: JSON.stringify(EMPTY_GAME_SETUP_LEARNED_OPTIONS),
        rememberedGameSetupText: JSON.stringify(EMPTY_GAME_SETUP_REMEMBERED_TEXT),
        legacyClientStateMigrated: "false",
        createdAt: timestamp,
        updatedAt: timestamp,
      });
      profiles = await tx.select().from(userProfiles).orderBy(asc(userProfiles.createdAt), asc(userProfiles.id));
      repairProfile = profiles.find((profile) => profile.id === DEFAULT_USER_PROFILE_ID) ?? profiles[0];
      changed = true;
    }

    if (!repairProfile) throw new Error("Failed to initialize User Profile storage");
    const validProfileIds = new Set(profiles.map((profile) => profile.id));

    for (const chat of await tx.select({ id: chats.id, profileId: chats.profileId }).from(chats)) {
      if (typeof chat.profileId !== "string" || !validProfileIds.has(chat.profileId)) {
        await tx.update(chats).set({ profileId: repairProfile.id }).where(eq(chats.id, chat.id));
        changed = true;
      }
    }

    for (const folder of await tx.select({ id: chatFolders.id, profileId: chatFolders.profileId }).from(chatFolders)) {
      if (typeof folder.profileId !== "string" || !validProfileIds.has(folder.profileId)) {
        await tx.update(chatFolders).set({ profileId: repairProfile.id }).where(eq(chatFolders.id, folder.id));
        changed = true;
      }
    }

    if (changed) logger.info("[db] Initialized or repaired user profile ownership");
    return changed;
  });
}

/** Backwards-compatible local name for older startup call sites. */
export const ensureDefaultUserProfile = ensureUserProfilesInitialized;
