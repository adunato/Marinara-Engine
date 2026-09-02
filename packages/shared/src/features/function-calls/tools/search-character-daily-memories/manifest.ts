import type { ToolDefinition } from "../../tool-definitions.js";

export const searchCharacterDailyMemoriesToolManifest = {
  name: "search_character_daily_memories",
  description: "Search the current character's Daily Memories for evidence relevant to a query.",
  parameters: {
    type: "object",
    properties: {
      query: { type: "string", description: "Semantic description of the memories or evidence to retrieve." },
    },
    required: ["query"],
    additionalProperties: false,
  },
} satisfies ToolDefinition;
