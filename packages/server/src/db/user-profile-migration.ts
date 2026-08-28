import { DEFAULT_USER_PROFILE_ID, EMPTY_GAME_SETUP_LEARNED_OPTIONS, EMPTY_GAME_SETUP_REMEMBERED_TEXT } from "@marinara-engine/shared";
import { logger } from "../lib/logger.js";
import type { DB } from "./connection.js";
import { asc, eq, isNull, or } from "./file-query.js";
import { chatFolders, chats } from "./schema/chats.js";
import { personas } from "./schema/characters.js";
import { userProfiles } from "./schema/user-profiles.js";

/**
 * Creates the legacy Default namespace once and repairs rows that predate
 * ownership. Existing distinct profiles are never merged or replaced.
 */
export async function ensureUserProfilesInitialized(db: DB): Promise<boolean> {
  let changed = false;
  let defaultProfile = (await db.select().from(userProfiles).where(eq(userProfiles.id, DEFAULT_USER_PROFILE_ID)))[0];
  if (!defaultProfile) {
    const activePersona = await db
      .select({ id: personas.id })
      .from(personas)
      .where(eq(personas.isActive, "true"))
      .orderBy(asc(personas.createdAt), asc(personas.id))
      .limit(1);
    const timestamp = new Date().toISOString();
    await db.insert(userProfiles).values({
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
    defaultProfile = (await db.select().from(userProfiles).where(eq(userProfiles.id, DEFAULT_USER_PROFILE_ID)))[0];
    changed = true;
  }

  // Legacy rows may lack the new column entirely or have been explicitly nulled.
  // Schema defaults normalize missing fields; this catches persisted empty values.
  await db.update(chats).set({ profileId: DEFAULT_USER_PROFILE_ID }).where(or(isNull(chats.profileId), eq(chats.profileId, "")));
  await db
    .update(chatFolders)
    .set({ profileId: DEFAULT_USER_PROFILE_ID })
    .where(or(isNull(chatFolders.profileId), eq(chatFolders.profileId, "")));

  if (changed) logger.info("[db] Bootstrapped default user profile");
  return changed;
}

/** Backwards-compatible local name for older startup call sites. */
export const ensureDefaultUserProfile = ensureUserProfilesInitialized;
