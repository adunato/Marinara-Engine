import type {
  CharacterMindBuildOrSyncResult,
  CharacterMindCancelResult,
  CharacterMindLintResult,
  CharacterMindQueryResult,
  CharacterMindStatus,
} from "@marinara-engine/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api } from "../lib/api-client";

export const characterMindKeys = {
  all: ["character-minds"] as const,
  status: (chatId: string, characterId: string) => [...characterMindKeys.all, chatId, characterId, "status"] as const,
};

function mindPath(chatId: string, characterId: string, operation: string) {
  return `/chats/${encodeURIComponent(chatId)}/character-minds/${encodeURIComponent(characterId)}/${operation}`;
}

export function useCharacterMindStatus(chatId: string, characterId: string, enabled = true) {
  return useQuery({
    queryKey: characterMindKeys.status(chatId, characterId),
    queryFn: () => api.get<CharacterMindStatus>(mindPath(chatId, characterId, "status")),
    enabled: enabled && !!chatId && !!characterId,
    refetchInterval: 2_000,
  });
}

function useCharacterMindMutation<T>(
  chatId: string,
  characterId: string,
  operation: string,
  body?: Record<string, unknown>,
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<T>(mindPath(chatId, characterId, operation), body ?? {}),
    onMutate: () => {
      void queryClient.invalidateQueries({ queryKey: characterMindKeys.status(chatId, characterId) });
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: characterMindKeys.status(chatId, characterId) }),
  });
}

export function useBuildCharacterMind(chatId: string, characterId: string) {
  return useCharacterMindMutation<CharacterMindBuildOrSyncResult>(chatId, characterId, "build");
}

export function useSyncCharacterMind(chatId: string, characterId: string) {
  return useCharacterMindMutation<CharacterMindBuildOrSyncResult>(chatId, characterId, "sync");
}

export function useLintCharacterMind(chatId: string, characterId: string) {
  return useCharacterMindMutation<CharacterMindLintResult>(chatId, characterId, "lint");
}

export function useCancelCharacterMind(chatId: string, characterId: string) {
  return useCharacterMindMutation<CharacterMindCancelResult>(chatId, characterId, "cancel");
}

export function useOpenCharacterMindFolder(chatId: string, characterId: string) {
  return useCharacterMindMutation<{ ok: true; path: string }>(chatId, characterId, "open-folder");
}

export function useQueryCharacterMind(chatId: string, characterId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (query: string) =>
      api.post<CharacterMindQueryResult>(mindPath(chatId, characterId, "query"), { query }),
    onMutate: () => {
      void queryClient.invalidateQueries({ queryKey: characterMindKeys.status(chatId, characterId) });
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: characterMindKeys.status(chatId, characterId) }),
  });
}
