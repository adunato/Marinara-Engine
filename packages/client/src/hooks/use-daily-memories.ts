import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  DailyMemory,
  DailyMemoryFormationResult,
  DailyMemoryListResponse,
  DailyMemoryRetrievalPreview,
} from "@marinara-engine/shared";
import { api } from "../lib/api-client";

export const dailyMemoryKeys = {
  detail: (chatId: string) => ["daily-memories", chatId] as const,
  preview: (chatId: string) => ["daily-memories", chatId, "preview"] as const,
};

export function useDailyMemories(chatId: string, enabled = true) {
  return useQuery({
    queryKey: dailyMemoryKeys.detail(chatId),
    queryFn: () => api.get<DailyMemoryListResponse>(`/chats/${chatId}/daily-memories`),
    enabled: enabled && Boolean(chatId),
  });
}

export function useDailyMemoryRetrievalPreview(chatId: string, enabled = true) {
  return useQuery({
    queryKey: dailyMemoryKeys.preview(chatId),
    queryFn: () => api.get<DailyMemoryRetrievalPreview>(`/chats/${chatId}/daily-memories/preview`),
    enabled: enabled && Boolean(chatId),
    staleTime: 0,
  });
}

export function useSaveDailyMemoryDay(chatId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      date,
      memories,
    }: {
      date: string;
      memories: Array<Pick<DailyMemory, "id" | "memory" | "importance">>;
    }) =>
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
      api.post<DailyMemoryFormationResult>(`/chats/${chatId}/daily-memories/${encodeURIComponent(date)}/generate`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: dailyMemoryKeys.detail(chatId) }),
  });
}
