import {
  DEFAULT_PROFESSOR_MARI_CUSTOM_PROMPT_SETTINGS,
  PROFESSOR_MARI_CUSTOM_PROMPT_SETTINGS_KEY,
  professorMariCustomPromptSettingsSchema,
  type ProfessorMariCustomPromptSettings,
} from "@marinara-engine/shared";
import type { DB } from "../../db/connection.js";
import { logger } from "../../lib/logger.js";
import { createAppSettingsStorage } from "../storage/app-settings.storage.js";

export async function readProfessorMariCustomPromptSettings(db: DB): Promise<ProfessorMariCustomPromptSettings> {
  let raw: string | null;
  try {
    raw = await createAppSettingsStorage(db).get(PROFESSOR_MARI_CUSTOM_PROMPT_SETTINGS_KEY);
  } catch (error) {
    logger.warn(error, "Professor Mari custom prompt settings are unavailable; using defaults");
    return { ...DEFAULT_PROFESSOR_MARI_CUSTOM_PROMPT_SETTINGS };
  }
  if (!raw) return { ...DEFAULT_PROFESSOR_MARI_CUSTOM_PROMPT_SETTINGS };

  try {
    const parsed = professorMariCustomPromptSettingsSchema.safeParse(JSON.parse(raw));
    if (parsed.success) return parsed.data;
    logger.warn({ issues: parsed.error.issues }, "Ignoring invalid stored Professor Mari custom prompt settings");
  } catch (error) {
    logger.warn(error, "Ignoring malformed stored Professor Mari custom prompt settings");
  }
  return { ...DEFAULT_PROFESSOR_MARI_CUSTOM_PROMPT_SETTINGS };
}
