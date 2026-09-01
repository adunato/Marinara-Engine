import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  CharacterDailyMemorySettingsPatch,
  CharacterDailyMemoryWindow,
} from "@marinara-engine/shared";
import {
  characterDailyMemoriesApi,
  type AddCharacterDailyMemoryInput,
  type UpdateCharacterDailyMemoryInput,
} from "../lib/character-daily-memories-api";

export const characterDailyMemoryKeys = {
  all: ["character-daily-memories"] as const,
  character: (characterId: string) => [...characterDailyMemoryKeys.all, characterId] as const,
  settings: (characterId: string) => [...characterDailyMemoryKeys.character(characterId), "settings"] as const,
  days: (characterId: string) => [...characterDailyMemoryKeys.character(characterId), "days"] as const,
  conversations: (characterId: string) =>
    [...characterDailyMemoryKeys.character(characterId), "conversations"] as const,
};

export function useCharacterDailyMemorySettings(characterId: string | null) {
  return useQuery({
    queryKey: characterDailyMemoryKeys.settings(characterId ?? ""),
    queryFn: () => characterDailyMemoriesApi.getSettings(characterId!),
    enabled: !!characterId,
    staleTime: 60_000,
  });
}

export function useCharacterDailyMemoryDays(characterId: string | null) {
  return useQuery({
    queryKey: characterDailyMemoryKeys.days(characterId ?? ""),
    queryFn: () => characterDailyMemoriesApi.getDays(characterId!),
    enabled: !!characterId,
    staleTime: 30_000,
  });
}

export function useCharacterDailyMemoryConversations(characterId: string | null) {
  return useQuery({
    queryKey: characterDailyMemoryKeys.conversations(characterId ?? ""),
    queryFn: () => characterDailyMemoriesApi.getConversations(characterId!),
    enabled: !!characterId,
    staleTime: 5 * 60_000,
  });
}

function invalidateCharacterMemoryQueries(queryClient: ReturnType<typeof useQueryClient>, characterId: string) {
  return Promise.all([
    queryClient.invalidateQueries({ queryKey: characterDailyMemoryKeys.settings(characterId) }),
    queryClient.invalidateQueries({ queryKey: characterDailyMemoryKeys.days(characterId) }),
    queryClient.invalidateQueries({ queryKey: characterDailyMemoryKeys.conversations(characterId) }),
  ]);
}

export function usePatchCharacterDailyMemorySettings() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ characterId, patch }: { characterId: string; patch: CharacterDailyMemorySettingsPatch }) =>
      characterDailyMemoriesApi.patchSettings(characterId, patch),
    onSuccess: (_settings, { characterId }) => invalidateCharacterMemoryQueries(queryClient, characterId),
  });
}

export function useGenerateCharacterDailyMemoryDay() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ characterId, window }: { characterId: string; window: CharacterDailyMemoryWindow }) =>
      characterDailyMemoriesApi.generate(characterId, window),
    onSuccess: (_day, { characterId }) => invalidateCharacterMemoryQueries(queryClient, characterId),
  });
}

export function useRegenerateCharacterDailyMemoryDay() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ characterId, dayId }: { characterId: string; dayId: string }) =>
      characterDailyMemoriesApi.regenerate(characterId, dayId),
    onSuccess: (_day, { characterId }) => invalidateCharacterMemoryQueries(queryClient, characterId),
  });
}

export function useDeleteCharacterDailyMemoryDay() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ characterId, dayId }: { characterId: string; dayId: string }) =>
      characterDailyMemoriesApi.deleteDay(characterId, dayId),
    onSuccess: (_result, { characterId }) => invalidateCharacterMemoryQueries(queryClient, characterId),
  });
}

export function useAddCharacterDailyMemory() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ characterId, input }: { characterId: string; input: AddCharacterDailyMemoryInput }) =>
      characterDailyMemoriesApi.addMemory(characterId, input),
    onSuccess: (_memory, { characterId }) => invalidateCharacterMemoryQueries(queryClient, characterId),
  });
}

export function useUpdateCharacterDailyMemory() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ characterId, input }: { characterId: string; input: UpdateCharacterDailyMemoryInput }) =>
      characterDailyMemoriesApi.updateMemory(characterId, input),
    onSuccess: (_memory, { characterId }) => invalidateCharacterMemoryQueries(queryClient, characterId),
  });
}

export function useDeleteCharacterDailyMemory() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ characterId, memoryId }: { characterId: string; memoryId: string }) =>
      characterDailyMemoriesApi.deleteMemory(characterId, memoryId),
    onSuccess: (_result, { characterId }) => invalidateCharacterMemoryQueries(queryClient, characterId),
  });
}

export function usePreviewCharacterDailyMemories() {
  return useMutation({
    mutationFn: ({ characterId, chatId }: { characterId: string; chatId: string }) =>
      characterDailyMemoriesApi.preview(characterId, chatId),
  });
}
