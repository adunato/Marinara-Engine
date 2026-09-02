import { z } from "zod";

export const characterBriefingPatchSchema = z
  .object({
    sourceTemplate: z.string().max(500_000).optional(),
    generationConnectionId: z.string().trim().min(1).nullable().optional(),
  })
  .refine((value) => value.sourceTemplate !== undefined || value.generationConnectionId !== undefined, {
    message: "At least one Character Briefing field is required",
  });
