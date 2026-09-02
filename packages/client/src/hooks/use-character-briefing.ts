import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { CharacterBriefingPatch } from "@marinara-engine/shared";
import { characterBriefingApi } from "../lib/character-briefing-api";

export const characterBriefingKeys = {
  all: ["character-briefing"] as const,
  detail: (characterId: string) => [...characterBriefingKeys.all, characterId] as const,
};

export function useCharacterBriefing(characterId: string | null) {
  return useQuery({
    queryKey: characterBriefingKeys.detail(characterId ?? ""),
    queryFn: () => characterBriefingApi.get(characterId!),
    enabled: !!characterId,
    staleTime: 30_000,
  });
}

export function useSaveCharacterBriefing() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ characterId, patch }: { characterId: string; patch: CharacterBriefingPatch }) =>
      characterBriefingApi.save(characterId, patch),
    onSuccess: (state) => queryClient.setQueryData(characterBriefingKeys.detail(state.characterId), state),
  });
}

export function useGenerateCharacterBriefing() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ characterId }: { characterId: string }) => characterBriefingApi.generate(characterId),
    onSuccess: (state) => queryClient.setQueryData(characterBriefingKeys.detail(state.characterId), state),
  });
}
