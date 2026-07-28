import {
  type DailyIntentionAreaKey,
  type DailyIntentionOutput,
  type DailyIntentionsResponse,
  type DailyIntentionsSettings,
} from "@marinara-engine/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api } from "../lib/api-client";

export const dailyIntentionsKeys = {
  all: ["daily-intentions"] as const,
  detail: (chatId: string) => [...dailyIntentionsKeys.all, chatId] as const,
};

export function useDailyIntentions(chatId: string, enabled = true) {
  return useQuery({
    queryKey: dailyIntentionsKeys.detail(chatId),
    queryFn: () => api.get<DailyIntentionsResponse>(`/chats/${chatId}/daily-intentions`),
    enabled: enabled && !!chatId,
  });
}
export function useUpdateDailyIntentionsSettings(chatId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (settings: DailyIntentionsSettings) =>
      api.put<DailyIntentionsResponse>(`/chats/${chatId}/daily-intentions/settings`, { settings }),
    onSuccess: (value) => queryClient.setQueryData(dailyIntentionsKeys.detail(chatId), value),
  });
}

export function useSaveDailyIntentionsOutputs(chatId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (outputs: Partial<Record<DailyIntentionAreaKey, string>>) =>
      api.put<DailyIntentionsResponse>(`/chats/${chatId}/daily-intentions/outputs`, { outputs }),
    onSuccess: (value) => queryClient.setQueryData(dailyIntentionsKeys.detail(chatId), value),
  });
}

export function useGenerateDailyIntention(chatId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (key: DailyIntentionAreaKey) =>
      api.post<{ key: DailyIntentionAreaKey; output: DailyIntentionOutput; error: null }>(
        `/chats/${chatId}/daily-intentions/generate/${key}`,
        {},
      ),
    onSuccess: ({ key, output }) => {
      queryClient.setQueryData<DailyIntentionsResponse>(dailyIntentionsKeys.detail(chatId), (current) =>
        current ? { ...current, outputs: { ...current.outputs, [key]: output } } : current,
      );
    },
  });
}

export type DailyIntentionsRunAllEvent =
  | { type: "area_started"; key: DailyIntentionAreaKey }
  | { type: "area_succeeded"; key: DailyIntentionAreaKey; output: DailyIntentionOutput }
  | { type: "area_failed"; key: DailyIntentionAreaKey; error: string }
  | { type: "error"; error: string }
  | { type: "done" };

export function useRunAllDailyIntentions(chatId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (onEvent?: (event: DailyIntentionsRunAllEvent) => void) => {
      const events: DailyIntentionsRunAllEvent[] = [];
      for await (const raw of api.streamEvents(`/chats/${chatId}/daily-intentions/generate-all`, {})) {
        const event = raw as unknown as DailyIntentionsRunAllEvent;
        events.push(event);
        if (event.type === "area_succeeded") {
          queryClient.setQueryData<DailyIntentionsResponse>(dailyIntentionsKeys.detail(chatId), (current) =>
            current
              ? { ...current, outputs: { ...current.outputs, [event.key]: event.output } }
              : current,
          );
        }
        onEvent?.(event);
      }
      return events;
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: dailyIntentionsKeys.detail(chatId) }),
  });
}
