import { z } from "zod";
import { chatModeSchema } from "./chat.schema.js";

const userStatusSchema = z.enum(["active", "idle", "dnd", "invisible"]);
const activitySchema = z.string().trim().max(120);
const learnedOptionsSchema = z.object({
  genres: z.array(z.string().trim().min(1).max(160)).max(60),
  tones: z.array(z.string().trim().min(1).max(160)).max(60),
  settings: z.array(z.string().trim().min(1).max(160)).max(60),
  goals: z.array(z.string().trim().min(1).max(160)).max(60),
  preferences: z.array(z.string().trim().min(1).max(160)).max(60),
});
const rememberedTextSchema = z.object({
  playerGoals: z.string().trim().max(2000),
  preferences: z.string().trim().max(2000),
});
const resumeChatsSchema = z.object({
  conversation: z.string().min(1).optional(),
  roleplay: z.string().min(1).optional(),
  game: z.string().min(1).optional(),
});

export const userProfileIdSchema = z.string().trim().min(1);
export const userProfileSchema = z.object({
  id: userProfileIdSchema,
  name: z.string().trim().min(1).max(200),
  activePersonaId: z.string().min(1).nullable(),
  lastActiveMode: chatModeSchema.nullable(),
  lastActiveChatByMode: resumeChatsSchema,
  userStatusManual: userStatusSchema,
  userStatus: userStatusSchema,
  userActivity: activitySchema,
  recentUserActivities: z.array(activitySchema).max(8),
  learnedGameSetupOptions: learnedOptionsSchema,
  rememberedGameSetupText: rememberedTextSchema,
  legacyClientStateMigrated: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const createUserProfileSchema = z.object({
  name: z.string().trim().min(1).max(200),
  activePersonaId: z.string().min(1).nullable().optional(),
});

export const patchUserProfileContinuitySchema = z
  .object({
    activePersonaId: z.string().min(1).nullable().optional(),
    lastActiveMode: chatModeSchema.nullable().optional(),
    lastActiveChatByMode: resumeChatsSchema.optional(),
    userStatusManual: userStatusSchema.optional(),
    userStatus: userStatusSchema.optional(),
    userActivity: activitySchema.optional(),
    recentUserActivities: z.array(activitySchema).max(8).optional(),
    learnedGameSetupOptions: learnedOptionsSchema.optional(),
    rememberedGameSetupText: rememberedTextSchema.optional(),
  })
  .strict();

export const renameUserProfileSchema = z.object({ name: z.string().trim().min(1).max(200) }).strict();

export const migrateLegacyUserProfileStateSchema = patchUserProfileContinuitySchema
  .extend({ lastActiveChatId: z.string().min(1).optional() })
  .strict();

export type UserProfileInput = z.infer<typeof userProfileSchema>;
export type CreateUserProfileInput = z.infer<typeof createUserProfileSchema>;
export type PatchUserProfileContinuityInput = z.infer<typeof patchUserProfileContinuitySchema>;
