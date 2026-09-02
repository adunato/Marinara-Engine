import { fileTable, text } from "../file-schema.js";
import { characters } from "./characters.js";
import { apiConnections } from "./connections.js";

export const characterBriefings = fileTable("character_briefings", {
  characterId: text("character_id")
    .primaryKey()
    .references(() => characters.id, { onDelete: "cascade" }),
  generationConnectionId: text("generation_connection_id").references(() => apiConnections.id, {
    onDelete: "set null",
  }),
  sourceTemplate: text("source_template").notNull().default(""),
  latestBriefing: text("latest_briefing"),
  latestGeneratedAt: text("latest_generated_at"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});
