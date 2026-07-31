import type { BuiltInAgentManifest } from "./agent-manifest.types.js";

export const DAILY_MEMORY_AGENT_ID = "daily-memory";
export const DAILY_INTENTIONS_AGENT_ID = "daily-intentions";
export const CHARACTER_MIND_AGENT_ID = "character-mind";

const DAILY_INTENTION_PROMPT_SUFFIX = `

Write one short-to-medium paragraph in the character's first person. Briefly ground it in the current situation and emotional position, but put most of the emphasis on what the character wants, decides, watches for, initiates, resists, reveals, explores, or leaves conditionally open today. Gently favor plausible initiative over waiting for someone else to act. Express intentions rather than guaranteed outcomes or control over another person's response. Preserve authentic uncertainty, ambivalence, restraint, avoidance, or a decision to observe. Do not invent events, conversations, or decisions as already having happened. Return only the free-text paragraph, with no heading, bullets, analysis, or structured data.`;

export const DEFAULT_DAILY_INTENTION_AREAS = [
  {
    key: "work_study",
    heading: "Work or Study",
    enabled: true,
    prompt:
      `Reflect on the character's work, study, responsibilities, ambitions, pressures, unfinished tasks, opportunities, and avoidance. Form their intention for how they will approach this area today and what they may proactively move forward.` +
      DAILY_INTENTION_PROMPT_SUFFIX,
  },
  {
    key: "friendships",
    heading: "Friendships",
    enabled: true,
    prompt:
      `Reflect on the character's friendships, social needs, loyalties, tensions, distance, support, curiosity, and unresolved interactions. Form their intention for how they will approach friends and social situations today and what they may proactively initiate.` +
      DAILY_INTENTION_PROMPT_SUFFIX,
  },
  {
    key: "romance",
    heading: "Romance",
    enabled: true,
    prompt:
      `Reflect on the character's romantic situation, attachments, hopes, uncertainty, jealousy, vulnerability, boundaries, and unresolved relationship movement. Form their intention for how they will approach romance today and what they may proactively reveal, ask, pursue, resist, or explore.` +
      DAILY_INTENTION_PROMPT_SUFFIX,
  },
  {
    key: "sex",
    heading: "Sex",
    enabled: true,
    prompt:
      `Reflect on the adult character's sexual feelings, desires, curiosity, confidence, hesitation, boundaries, consent, and relevant relationship context. Form their intention for how they will approach this area today, without assuming another person's interest, consent, or response.` +
      DAILY_INTENTION_PROMPT_SUFFIX,
  },
] as const;

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
  {
    id: DAILY_INTENTIONS_AGENT_ID,
    name: "Daily Intentions",
    description:
      "Creates editable first-person intentions across four focused life areas for a single-character Conversation.",
    author: "Pasta Devs",
    phase: "pre_generation",
    enabledByDefault: false,
    category: "misc",
    modeAllowlist: ["conversation"],
    execution: "managed",
    defaultSettings: {},
  },
  {
    id: CHARACTER_MIND_AGENT_ID,
    name: "Character Mind",
    description:
      "Maintains a per-character Markdown wiki from Character Cards and Daily Memories, and queries it as a cited briefing.",
    author: "Pasta Devs",
    phase: "pre_generation",
    enabledByDefault: false,
    category: "misc",
    modeAllowlist: ["conversation"],
    execution: "managed",
    defaultSettings: {},
  },
];
