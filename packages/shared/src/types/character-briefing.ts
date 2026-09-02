/** Shared contracts for character-owned generated briefings. */
export type CharacterBriefingState = {
  characterId: string;
  sourceTemplate: string;
  generationConnectionId: string | null;
  latestBriefing: string | null;
  latestGeneratedAt: string | null;
  createdAt: string | null;
  updatedAt: string | null;
};
export type CharacterBriefingPatch = { sourceTemplate?: string; generationConnectionId?: string | null };
export type CharacterBriefingEntityType = "character" | "lorebook";
export type CharacterBriefingEntityReference = {
  type: CharacterBriefingEntityType;
  id: string;
  label: string;
  startOffset: number;
  endOffsetExclusive: number;
};
export type CharacterBriefingInstructionSlot = {
  slotIndex: number;
  startOffset: number;
  endOffsetExclusive: number;
  raw: string;
  instruction: string;
  references: CharacterBriefingEntityReference[];
};
