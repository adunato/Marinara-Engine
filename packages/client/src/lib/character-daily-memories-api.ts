import type {
  CharacterDailyMemory,
  CharacterDailyMemoryConversationDescriptor,
  CharacterDailyMemoryDay,
  CharacterDailyMemoryMissingDay,
  CharacterDailyMemoryRun,
  CharacterDailyMemoryRunSource,
  CharacterDailyMemorySettings,
  CharacterDailyMemorySettingsPatch,
  CharacterDailyMemoryWindow,
} from "@marinara-engine/shared";
import { api } from "./api-client";

export interface CharacterDailyMemoryDayView {
  day: CharacterDailyMemoryDay;
  run: CharacterDailyMemoryRun | null;
  sources: CharacterDailyMemoryRunSource[];
  memories: CharacterDailyMemory[];
}

export interface CharacterDailyMemoryDaysResponse {
  days: CharacterDailyMemoryDayView[];
  missingDays: CharacterDailyMemoryMissingDay[];
}

export interface CharacterDailyMemoryPreviewItem extends CharacterDailyMemory {
  semanticScore?: number;
  importanceScore?: number;
  recencyScore?: number;
  rankScore?: number;
}

export interface CharacterDailyMemoryPreviewResult {
  memories: CharacterDailyMemoryPreviewItem[];
  embeddingSpaceId?: string | null;
  degraded?: boolean;
}

export interface AddCharacterDailyMemoryInput {
  dayId?: string;
  text: string;
  importance: number;
}

export interface UpdateCharacterDailyMemoryInput {
  memoryId: string;
  text?: string;
  importance?: number;
}

const path = (characterId: string, suffix: string) =>
  `/characters/${encodeURIComponent(characterId)}/daily-memories${suffix}`;

export const characterDailyMemoriesApi = {
  getSettings: (characterId: string) =>
    api.get<CharacterDailyMemorySettings>(path(characterId, "/settings")),

  patchSettings: (characterId: string, patch: CharacterDailyMemorySettingsPatch) =>
    api.patch<CharacterDailyMemorySettings>(path(characterId, "/settings"), patch),

  getDays: (characterId: string) =>
    api.get<CharacterDailyMemoryDaysResponse>(path(characterId, "/days")),

  generate: (characterId: string, window: CharacterDailyMemoryWindow) =>
    api.post<CharacterDailyMemoryDayView>(path(characterId, "/generate"), window),

  regenerate: (characterId: string, dayId: string) =>
    api.post<CharacterDailyMemoryDayView>(path(characterId, `/days/${encodeURIComponent(dayId)}/regenerate`)),

  deleteDay: (characterId: string, dayId: string) =>
    api.delete(path(characterId, `/days/${encodeURIComponent(dayId)}`)),

  addMemory: (characterId: string, input: AddCharacterDailyMemoryInput) =>
    api.post<CharacterDailyMemory>(path(characterId, "/memories"), input),

  updateMemory: (characterId: string, input: UpdateCharacterDailyMemoryInput) => {
    const { memoryId, ...patch } = input;
    return api.patch<CharacterDailyMemory>(
      path(characterId, `/memories/${encodeURIComponent(memoryId)}`),
      patch,
    );
  },

  deleteMemory: (characterId: string, memoryId: string) =>
    api.delete(path(characterId, `/memories/${encodeURIComponent(memoryId)}`)),

  getConversations: async (characterId: string) => {
    const response = await api.get<
      { conversations: CharacterDailyMemoryConversationDescriptor[] } | CharacterDailyMemoryConversationDescriptor[]
    >(path(characterId, "/conversations"));
    return Array.isArray(response) ? response : response.conversations;
  },

  preview: (characterId: string, chatId: string) =>
    api.post<CharacterDailyMemoryPreviewResult>(path(characterId, "/preview"), { chatId }),
};
