import { z } from "zod";
import {
  CHARACTER_DAILY_MEMORY_DEFAULT_PROMPT,
  CHARACTER_DAILY_MEMORY_DEFAULTS,
  type CharacterDailyMemoryFormationOutput,
} from "../types/character-daily-memory.js";

export const characterDailyMemoryHandoverTimeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Expected HH:mm");

export const characterDailyMemorySettingsSchema = z.object({
  characterId: z.string().trim().min(1),
  enabled: z.boolean(),
  handoverTime: characterDailyMemoryHandoverTimeSchema,
  formationConnectionId: z.string().trim().min(1).nullable(),
  formationPrompt: z.string().min(1),
  retrievalMessageCount: z.number().int().min(0),
  semanticWeight: z.number().finite(),
  importanceWeight: z.number().finite(),
  recencyWeight: z.number().finite(),
  minimumRankPercent: z.number().finite().min(0).max(100),
  autoStartWindowEndAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export const characterDailyMemorySettingsPatchSchema = characterDailyMemorySettingsSchema
  .omit({ characterId: true, createdAt: true, updatedAt: true, autoStartWindowEndAt: true })
  .partial();

export const characterDailyMemoryFormationOutputSchema = z.object({
  memories: z.array(
    z.object({
      text: z.string().trim().min(1),
      importance: z.number().int().min(1).max(5),
    }),
  ),
});

export const characterDailyMemoryDefaults = {
  ...CHARACTER_DAILY_MEMORY_DEFAULTS,
  formationPrompt: CHARACTER_DAILY_MEMORY_DEFAULT_PROMPT,
};

export type CharacterDailyMemoryFormationOutputInput = z.input<typeof characterDailyMemoryFormationOutputSchema>;
export type CharacterDailyMemoryFormationOutputParsed = z.output<typeof characterDailyMemoryFormationOutputSchema>;

export function parseCharacterDailyMemoryFormationOutput(value: unknown): CharacterDailyMemoryFormationOutput {
  return characterDailyMemoryFormationOutputSchema.parse(value);
}
