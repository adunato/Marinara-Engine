import {
  EMPTY_GAME_SETUP_LEARNED_OPTIONS,
  EMPTY_GAME_SETUP_REMEMBERED_TEXT,
  type CreateUserProfileInput,
  type PatchUserProfileContinuityInput,
} from "@marinara-engine/shared";
import { asc, eq } from "../../db/file-query.js";
import type { DB } from "../../db/connection.js";
import { userProfiles } from "../../db/schema/index.js";
import { newId, now } from "../../utils/id-generator.js";

export interface UpdateUserProfileInput extends PatchUserProfileContinuityInput {
  name?: string;
}

const json = (value: unknown, fallback: unknown) => JSON.stringify(value ?? fallback);

function continuityFields(data: PatchUserProfileContinuityInput) {
  return {
    ...(data.activePersonaId !== undefined && { activePersonaId: data.activePersonaId }),
    ...(data.lastActiveMode !== undefined && { lastActiveMode: data.lastActiveMode }),
    ...(data.lastActiveChatByMode !== undefined && { lastActiveChatByMode: json(data.lastActiveChatByMode, {}) }),
    ...(data.userStatusManual !== undefined && { userStatusManual: data.userStatusManual }),
    ...(data.userStatus !== undefined && { userStatus: data.userStatus }),
    ...(data.userActivity !== undefined && { userActivity: data.userActivity }),
    ...(data.recentUserActivities !== undefined && { recentUserActivities: json(data.recentUserActivities, []) }),
    ...(data.learnedGameSetupOptions !== undefined && {
      learnedGameSetupOptions: json(data.learnedGameSetupOptions, EMPTY_GAME_SETUP_LEARNED_OPTIONS),
    }),
    ...(data.rememberedGameSetupText !== undefined && {
      rememberedGameSetupText: json(data.rememberedGameSetupText, EMPTY_GAME_SETUP_REMEMBERED_TEXT),
    }),
  };
}

export function createUserProfilesStorage(db: DB) {
  return {
    async list() {
      return db.select().from(userProfiles).orderBy(asc(userProfiles.createdAt), asc(userProfiles.id));
    },
    async getById(id: string) {
      return (await db.select().from(userProfiles).where(eq(userProfiles.id, id)))[0] ?? null;
    },
    async create(input: CreateUserProfileInput) {
      const id = newId();
      const timestamp = now();
      await db.insert(userProfiles).values({
        id,
        name: input.name,
        activePersonaId: input.activePersonaId ?? null,
        lastActiveMode: null,
        lastActiveChatByMode: "{}",
        userStatusManual: "active",
        userStatus: "active",
        userActivity: "",
        recentUserActivities: "[]",
        learnedGameSetupOptions: JSON.stringify(EMPTY_GAME_SETUP_LEARNED_OPTIONS),
        rememberedGameSetupText: JSON.stringify(EMPTY_GAME_SETUP_REMEMBERED_TEXT),
        legacyClientStateMigrated: "true",
        createdAt: timestamp,
        updatedAt: timestamp,
      });
      return this.getById(id);
    },
    async update(id: string, data: UpdateUserProfileInput) {
      await db
        .update(userProfiles)
        .set({
          ...(data.name !== undefined && { name: data.name }),
          ...continuityFields(data),
          updatedAt: now(),
        })
        .where(eq(userProfiles.id, id));
      return this.getById(id);
    },
    async migrateLegacyClientState(id: string, data: PatchUserProfileContinuityInput) {
      return db.transaction(async (tx) => {
        const before = (await tx.select().from(userProfiles).where(eq(userProfiles.id, id)))[0] ?? null;
        if (!before) return { row: null, migrated: false };
        if (before.legacyClientStateMigrated === "true") return { row: before, migrated: false };
        await tx
          .update(userProfiles)
          .set({ ...continuityFields(data), legacyClientStateMigrated: "true", updatedAt: now() })
          .where(eq(userProfiles.id, id));
        const row = (await tx.select().from(userProfiles).where(eq(userProfiles.id, id)))[0] ?? null;
        return { row, migrated: true };
      });
    },
    async clearPersonaReferences(personaId: string) {
      const profiles = await this.list();
      await Promise.all(
        profiles
          .filter((profile) => profile.activePersonaId === personaId)
          .map((profile) => this.update(profile.id, { activePersonaId: null })),
      );
    },
  };
}
