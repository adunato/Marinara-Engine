import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { DailyMemory, DailyMemoryFormationResult, DailyMemoryListResponse } from "@marinara-engine/shared";
import { api } from "../lib/api-client";

export const dailyMemoryKeys = {
  detail: (chatId: string) => ["daily-memories", chatId] as const,
};

export function useDailyMemories(chatId: string, enabled = true) {
  return useQuery({
    queryKey: dailyMemoryKeys.detail(chatId),
    queryFn: () => api.get<DailyMemoryListResponse>(`/chats/${chatId}/daily-memories`),
    enabled: enabled && Boolean(chatId),
  });
}

export function useSaveDailyMemoryDay(chatId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ date, memories }: { date: string; memories: Array<Pick<DailyMemory, "id" | "memory" | "importance">> }) =>
      api.put<DailyMemoryFormationResult>(`/chats/${chatId}/daily-memories/${encodeURIComponent(date)}`, {
        memories,
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: dailyMemoryKeys.detail(chatId) }),
  });
}

export function useGenerateDailyMemoryDay(chatId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (date: string) =>
      api.post<DailyMemoryFormationResult>(
        `/chats/${chatId}/daily-memories/${encodeURIComponent(date)}/generate`,
      ),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: dailyMemoryKeys.detail(chatId) }),
  });
}
