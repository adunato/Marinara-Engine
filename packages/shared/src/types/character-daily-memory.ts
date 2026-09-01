/** Shared contracts for character-owned Conversation daily memories. */

export const CHARACTER_DAILY_MEMORY_DEFAULTS = {
  handoverTime: "04:00",
  semanticWeight: 50,
  importanceWeight: 35,
  recencyWeight: 15,
  minimumRankPercent: 30,
  recencyHalfLifeDays: 30,
  retrievalMessageCount: 20,
} as const;

export const CHARACTER_DAILY_MEMORY_DEFAULT_PROMPT =
  "Review this Conversation for the target character and return up to ten nuanced, short-paragraph memories when warranted. Return fewer or zero when appropriate. Each memory must include an importance score from 1 through 5. Only include information the target character would reasonably remember.";

export type CharacterDailyMemoryDayStatus = "pending" | "partial" | "complete" | "empty" | "failed" | "deleted";
export type CharacterDailyMemoryRunKind =
  | "scheduled"
  | "startup"
  | "manual-generate"
  | "regenerate"
  | "manual-only";
export type CharacterDailyMemoryRunStatus =
  | "pending"
  | "running"
  | "partial"
  | "complete"
  | "empty"
  | "failed";
export type CharacterDailyMemoryRunSourceStatus = "pending" | "running" | "success" | "empty" | "failed";
export type CharacterDailyMemoryOrigin = "formed" | "manual";

export interface CharacterDailyMemorySettings {
  characterId: string;
  enabled: boolean;
  handoverTime: string;
  formationConnectionId: string | null;
  formationPrompt: string;
  retrievalMessageCount: number;
  semanticWeight: number;
  importanceWeight: number;
  recencyWeight: number;
  minimumRankPercent: number;
  autoStartWindowEndAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export type CharacterDailyMemorySettingsPatch = Partial<
  Omit<CharacterDailyMemorySettings, "characterId" | "createdAt" | "updatedAt" | "autoStartWindowEndAt">
>;

export interface CharacterDailyMemoryWindow {
  dayKey: string;
  windowStartAt: string;
  windowEndAt: string;
  timeZone?: string;
  handoverTime: string;
}

export interface CharacterDailyMemoryDay {
  id: string;
  characterId: string;
  dayKey: string;
  windowStartAt: string;
  windowEndAt: string;
  timeZone: string | null;
  handoverTime: string;
  status: CharacterDailyMemoryDayStatus;
  activeRunId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CharacterDailyMemoryRun {
  id: string;
  dayId: string;
  kind: CharacterDailyMemoryRunKind;
  status: CharacterDailyMemoryRunStatus;
  sourceConversationIds: string[];
  connectionId: string | null;
  model: string | null;
  replacementOfRunId: string | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CharacterDailyMemoryRunSource {
  id: string;
  runId: string;
  sourceConversationId: string;
  sourceConversationName: string;
  status: CharacterDailyMemoryRunSourceStatus;
  attempts: number;
  lastError: string | null;
  nextRetryAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CharacterDailyMemory {
  id: string;
  characterId: string;
  dayId: string;
  runId: string;
  runSourceId: string | null;
  origin: CharacterDailyMemoryOrigin;
  sourceConversationId: string | null;
  sourceConversationName: string | null;
  text: string;
  importance: number;
  embedding: number[] | null;
  embeddingSpaceId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CharacterDailyMemoryFormationOutput {
  memories: Array<{ text: string; importance: number }>;
}

export interface CharacterDailyMemoryMissingDay extends CharacterDailyMemoryWindow {
  characterId: string;
  reason: "missing" | "deleted";
}

export interface CharacterDailyMemoryConversationDescriptor {
  id: string;
  name: string;
  firstEligibleMessageAt: string;
}
