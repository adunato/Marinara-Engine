import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  PROFESSOR_MARI_CUSTOM_PROMPT_SETTINGS_KEY,
  normalizeProfessorMariCustomPromptSettings,
  type ProfessorMariCustomPromptSettings,
} from "@marinara-engine/shared";
import { api } from "../lib/api-client";

export const professorMariCustomPromptKeys = {
  settings: ["app-settings", PROFESSOR_MARI_CUSTOM_PROMPT_SETTINGS_KEY] as const,
};

export function useProfessorMariCustomPromptSettings() {
  return useQuery({
    queryKey: professorMariCustomPromptKeys.settings,
    queryFn: async () => {
      const settings = await api.get<ProfessorMariCustomPromptSettings>(
        `/app-settings/${PROFESSOR_MARI_CUSTOM_PROMPT_SETTINGS_KEY}`,
      );
      return normalizeProfessorMariCustomPromptSettings(settings);
    },
    staleTime: 5 * 60_000,
  });
}

export function useUpdateProfessorMariCustomPromptSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (settings: ProfessorMariCustomPromptSettings) => {
      const normalized = normalizeProfessorMariCustomPromptSettings(settings);
      return api.put<ProfessorMariCustomPromptSettings>(
        `/app-settings/${PROFESSOR_MARI_CUSTOM_PROMPT_SETTINGS_KEY}`,
        normalized,
      );
    },
    onSuccess: (settings) => {
      qc.setQueryData(professorMariCustomPromptKeys.settings, normalizeProfessorMariCustomPromptSettings(settings));
    },
  });
}
