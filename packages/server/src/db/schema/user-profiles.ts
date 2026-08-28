import { fileTable, text } from "../file-schema.js";

/** Named history namespaces and their small, server-canonical continuity state. */
export const userProfiles = fileTable("user_profiles", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  activePersonaId: text("active_persona_id"),
  lastActiveMode: text("last_active_mode"),
  lastActiveChatByMode: text("last_active_chat_by_mode").notNull().default("{}"),
  userStatusManual: text("user_status_manual").notNull().default("active"),
  userStatus: text("user_status").notNull().default("active"),
  userActivity: text("user_activity").notNull().default(""),
  recentUserActivities: text("recent_user_activities").notNull().default("[]"),
  learnedGameSetupOptions: text("learned_game_setup_options").notNull().default('{"genres":[],"tones":[],"settings":[],"goals":[],"preferences":[]}'),
  rememberedGameSetupText: text("remembered_game_setup_text").notNull().default('{"playerGoals":"","preferences":""}'),
  legacyClientStateMigrated: text("legacy_client_state_migrated").notNull().default("true"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});
