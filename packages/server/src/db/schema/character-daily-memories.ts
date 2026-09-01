import { fileTable, integer, text } from "../file-schema.js";
import { characters } from "./characters.js";

export const characterDailyMemorySettings = fileTable("character_daily_memory_settings", {
  characterId: text("character_id").primaryKey().references(() => characters.id, { onDelete: "cascade" }),
  enabled: text("enabled", { enum: ["true", "false"] }).notNull().default("false"),
  handoverTime: text("handover_time").notNull().default("04:00"),
  formationConnectionId: text("formation_connection_id"),
  formationPrompt: text("formation_prompt").notNull().default(""),
  retrievalMessageCount: integer("retrieval_message_count").notNull().default(20),
  semanticWeight: integer("semantic_weight").notNull().default(50),
  importanceWeight: integer("importance_weight").notNull().default(35),
  recencyWeight: integer("recency_weight").notNull().default(15),
  minimumRankPercent: integer("minimum_rank_percent").notNull().default(30),
  autoStartWindowEndAt: text("auto_start_window_end_at"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const characterDailyMemoryDays = fileTable(
  "character_daily_memory_days",
  {
    id: text("id").primaryKey(),
    characterId: text("character_id").notNull().references(() => characters.id, { onDelete: "cascade" }),
    dayKey: text("day_key").notNull(),
    windowStartAt: text("window_start_at").notNull(),
    windowEndAt: text("window_end_at").notNull(),
    timeZone: text("time_zone"),
    handoverTime: text("handover_time").notNull(),
    status: text("status", { enum: ["pending", "partial", "complete", "empty", "failed", "deleted"] }).notNull(),
    activeRunId: text("active_run_id"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  { uniqueBy: [["characterId", "windowEndAt"]] },
);

export const characterDailyMemoryRuns = fileTable("character_daily_memory_runs", {
  id: text("id").primaryKey(),
  dayId: text("day_id").notNull().references(() => characterDailyMemoryDays.id, { onDelete: "cascade" }),
  kind: text("kind", { enum: ["scheduled", "startup", "manual-generate", "regenerate", "manual-only"] }).notNull(),
  status: text("status", { enum: ["pending", "running", "partial", "complete", "empty", "failed"] }).notNull(),
  sourceConversationIds: text("source_conversation_ids").notNull().default("[]"),
  connectionId: text("connection_id"),
  model: text("model"),
  replacementOfRunId: text("replacement_of_run_id"),
  startedAt: text("started_at"),
  completedAt: text("completed_at"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const characterDailyMemoryRunSources = fileTable(
  "character_daily_memory_run_sources",
  {
    id: text("id").primaryKey(),
    runId: text("run_id").notNull().references(() => characterDailyMemoryRuns.id, { onDelete: "cascade" }),
    sourceConversationId: text("source_conversation_id").notNull(),
    sourceConversationName: text("source_conversation_name").notNull().default(""),
    status: text("status", { enum: ["pending", "running", "success", "empty", "failed"] }).notNull(),
    attempts: integer("attempts").notNull().default(0),
    lastError: text("last_error"),
    nextRetryAt: text("next_retry_at"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  { uniqueBy: [["runId", "sourceConversationId"]] },
);

export const characterDailyMemories = fileTable("character_daily_memories", {
  id: text("id").primaryKey(),
  characterId: text("character_id").notNull().references(() => characters.id, { onDelete: "cascade" }),
  dayId: text("day_id").notNull().references(() => characterDailyMemoryDays.id, { onDelete: "cascade" }),
  runId: text("run_id").notNull().references(() => characterDailyMemoryRuns.id, { onDelete: "cascade" }),
  runSourceId: text("run_source_id").references(() => characterDailyMemoryRunSources.id, { onDelete: "cascade" }),
  origin: text("origin", { enum: ["formed", "manual"] }).notNull(),
  sourceConversationId: text("source_conversation_id"),
  sourceConversationName: text("source_conversation_name"),
  text: text("text").notNull(),
  importance: integer("importance").notNull(),
  embedding: text("embedding"),
  embeddingSpaceId: text("embedding_space_id"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});
