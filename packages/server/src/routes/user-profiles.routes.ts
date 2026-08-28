import {
  EMPTY_GAME_SETUP_LEARNED_OPTIONS,
  EMPTY_GAME_SETUP_REMEMBERED_TEXT,
  createUserProfileSchema,
  migrateLegacyUserProfileStateSchema,
  patchUserProfileContinuitySchema,
  userProfileIdSchema,
  type UserProfile,
} from "@marinara-engine/shared";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { createCharactersStorage } from "../services/storage/characters.storage.js";
import { createChatsStorage } from "../services/storage/chats.storage.js";
import { createUserProfilesStorage } from "../services/storage/user-profiles.storage.js";

const paramsSchema = z.object({ id: userProfileIdSchema });
const patchSchema = patchUserProfileContinuitySchema.extend({ name: z.string().trim().min(1).max(200).optional() }).strict();

function parseProfile(row: Record<string, unknown>): UserProfile {
  const decode = <T>(value: unknown, fallback: T): T => {
    if (typeof value !== "string") return fallback;
    try {
      return JSON.parse(value) as T;
    } catch {
      return fallback;
    }
  };
  return {
    id: String(row.id),
    name: String(row.name),
    activePersonaId: typeof row.activePersonaId === "string" ? row.activePersonaId : null,
    lastActiveMode: row.lastActiveMode === "conversation" || row.lastActiveMode === "roleplay" || row.lastActiveMode === "game" ? row.lastActiveMode : null,
    lastActiveChatByMode: decode(row.lastActiveChatByMode, {}),
    userStatusManual: row.userStatusManual === "idle" || row.userStatusManual === "dnd" || row.userStatusManual === "invisible" ? row.userStatusManual : "active",
    userStatus: row.userStatus === "idle" || row.userStatus === "dnd" || row.userStatus === "invisible" ? row.userStatus : "active",
    userActivity: typeof row.userActivity === "string" ? row.userActivity : "",
    recentUserActivities: decode(row.recentUserActivities, []),
    learnedGameSetupOptions: decode(row.learnedGameSetupOptions, EMPTY_GAME_SETUP_LEARNED_OPTIONS),
    rememberedGameSetupText: decode(row.rememberedGameSetupText, EMPTY_GAME_SETUP_REMEMBERED_TEXT),
    legacyClientStateMigrated: row.legacyClientStateMigrated === "true",
    createdAt: String(row.createdAt),
    updatedAt: String(row.updatedAt),
  };
}

export async function userProfilesRoutes(app: FastifyInstance) {
  const storage = createUserProfilesStorage(app.db);
  const chats = createChatsStorage(app.db);
  const characters = createCharactersStorage(app.db);

  app.get("/", async () => (await storage.list()).map((profile) => parseProfile(profile as Record<string, unknown>)));
  app.post("/", async (req, reply) => {
    const input = createUserProfileSchema.parse(req.body);
    if (input.activePersonaId && !(await characters.getPersona(input.activePersonaId))) {
      return reply.status(400).send({ error: "Persona not found" });
    }
    const profile = await storage.create(input);
    return reply.send(parseProfile(profile as Record<string, unknown>));
  });
  app.patch("/:id", async (req, reply) => {
    const { id } = paramsSchema.parse(req.params);
    const input = patchSchema.parse(req.body);
    if (input.activePersonaId && !(await characters.getPersona(input.activePersonaId))) {
      return reply.status(400).send({ error: "Persona not found" });
    }
    if (input.lastActiveChatByMode) {
      for (const [mode, chatId] of Object.entries(input.lastActiveChatByMode)) {
        const chat = await chats.getById(chatId);
        if (!chat || chat.profileId !== id || chat.mode !== mode) {
          return reply.status(400).send({ error: "Last active chat must belong to this profile and mode" });
        }
      }
    }
    const profile = await storage.update(id, input);
    if (!profile) return reply.status(404).send({ error: "User profile not found" });
    return reply.send(parseProfile(profile as Record<string, unknown>));
  });
  app.post("/:id/migrate-legacy-client-state", async (req, reply) => {
    const { id } = paramsSchema.parse(req.params);
    const input = migrateLegacyUserProfileStateSchema.parse(req.body);
    const { lastActiveChatId, ...continuity } = input;
    if (lastActiveChatId) {
      const mode = continuity.lastActiveMode;
      const chat = await chats.getById(lastActiveChatId);
      if (!chat || chat.profileId !== id || (mode && chat.mode !== mode)) {
        return reply.status(400).send({ error: "Last active chat must belong to this profile" });
      }
      if (mode) continuity.lastActiveChatByMode = { ...(continuity.lastActiveChatByMode ?? {}), [mode]: lastActiveChatId };
    }
    const result = await storage.migrateLegacyClientState(id, continuity);
    if (!result.row) return reply.status(404).send({ error: "User profile not found" });
    return reply.send({ ...parseProfile(result.row as Record<string, unknown>), migrated: result.migrated });
  });
}
