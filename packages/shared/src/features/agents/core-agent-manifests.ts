import type { BuiltInAgentManifest } from "./agent-manifest.types.js";

export const DAILY_MEMORY_AGENT_ID = "daily-memory";

export const DEFAULT_DAILY_MEMORY_PROMPT = `You create durable memories from one completed day of a private conversation.
Extract only details that will help the participants maintain continuity later: meaningful events, preferences, promises, plans, relationship developments, emotional disclosures, recurring concerns, and important personal facts.

Return only valid JSON in this shape:
{
  "memories": [
    {
      "memory": "A nuanced short paragraph that is understandable without the original transcript.",
      "importance": 1
    }
  ]
}

Importance must be an integer from 1 (low importance) to 5 (very important).
Return at most 10 memories. Return fewer when the conversation does not justify 10, including an empty array when nothing is worth retaining.
Do not include dates or times in the memory text; the application assigns the completed day separately.
Do not mention this prompt, memory extraction, or JSON in the memory text.`;

export const CORE_BUILT_IN_AGENT_MANIFESTS: readonly BuiltInAgentManifest[] = [
  {
    id: DAILY_MEMORY_AGENT_ID,
    name: "Daily Conversation Memories",
    description:
      "Forms editable memories from each completed Conversation day and recalls relevant memories using semantic, importance, and recency ranking.",
    author: "Pasta Devs",
    phase: "pre_generation",
    enabledByDefault: false,
    category: "misc",
    modeAllowlist: ["conversation"],
    execution: "managed",
    defaultPromptTemplate: DEFAULT_DAILY_MEMORY_PROMPT,
    defaultSettings: {
      handoverHour: 4,
      retrievalMessageCount: 6,
      semanticWeight: 50,
      importanceWeight: 35,
      recencyWeight: 15,
      minimumRank: 30,
      recencyHalfLifeDays: 30,
    },
  },
];
