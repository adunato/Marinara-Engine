// ──────────────────────────────────────────────
// React Query: Chat Folder hooks
// ──────────────────────────────────────────────
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api-client";
import type {
  ChatFolder,
  CreateChatFolderInput,
  MoveChatToFolderInput,
  ReorderFoldersInput,
  UpdateFolderInput,
} from "@marinara-engine/shared";
import { chatKeys } from "./use-chats";
import { useUserProfileStore } from "../stores/user-profile.store";

export const folderKeys = {
  all: ["chat-folders"] as const,
  list: () => [...folderKeys.all, "list"] as const,
  listForProfile: (profileId: string) => [...folderKeys.list(), profileId] as const,
};

export function useChatFolders() {
  const profileId = useUserProfileStore((state) => state.activeProfileId);
  const ready = useUserProfileStore((state) => state.isBootstrapped && !state.isSwitching);
  return useQuery({
    queryKey: folderKeys.listForProfile(profileId ?? ""),
    queryFn: () => api.get<ChatFolder[]>(`/chat-folders?profileId=${encodeURIComponent(profileId!)}`),
    enabled: !!profileId && ready,
    staleTime: 2 * 60_000,
  });
}

export function useCreateFolder() {
  const qc = useQueryClient();
  const profileId = useUserProfileStore((state) => state.activeProfileId);
  return useMutation({
    mutationFn: (data: Omit<CreateChatFolderInput, "profileId">) => {
      if (!profileId) throw new Error("No active User Profile");
      return api.post<ChatFolder>("/chat-folders", { ...data, profileId });
    },
    onSuccess: (folder) => qc.invalidateQueries({ queryKey: folderKeys.listForProfile(folder.profileId) }),
  });
}

export function useUpdateFolder() {
  const qc = useQueryClient();
  const profileId = useUserProfileStore((state) => state.activeProfileId);
  return useMutation({
    mutationFn: ({ id, ...data }: Omit<UpdateFolderInput, "profileId"> & { id: string }) => {
      if (!profileId) throw new Error("No active User Profile");
      return api.patch<ChatFolder>(`/chat-folders/${id}`, { ...data, profileId });
    },
    onSuccess: (folder) => qc.invalidateQueries({ queryKey: folderKeys.listForProfile(folder.profileId) }),
  });
}

export function useDeleteFolder() {
  const qc = useQueryClient();
  const profileId = useUserProfileStore((state) => state.activeProfileId);
  return useMutation({
    mutationFn: (id: string) => {
      if (!profileId) throw new Error("No active User Profile");
      return api.delete(`/chat-folders/${id}?profileId=${encodeURIComponent(profileId)}`);
    },
    onSuccess: () => {
      if (!profileId) return;
      qc.invalidateQueries({ queryKey: folderKeys.listForProfile(profileId) });
      qc.invalidateQueries({ queryKey: chatKeys.listForProfile(profileId) });
    },
  });
}

export function useReorderFolders() {
  const qc = useQueryClient();
  const profileId = useUserProfileStore((state) => state.activeProfileId);
  return useMutation({
    mutationFn: (orderedIds: ReorderFoldersInput["orderedIds"]) => {
      if (!profileId) throw new Error("No active User Profile");
      return api.post(
        `/chat-folders/reorder?profileId=${encodeURIComponent(profileId)}`,
        { orderedIds, profileId } satisfies ReorderFoldersInput,
      );
    },
    onSuccess: () => {
      if (profileId) qc.invalidateQueries({ queryKey: folderKeys.listForProfile(profileId) });
    },
  });
}

export function useMoveChat() {
  const qc = useQueryClient();
  const profileId = useUserProfileStore((state) => state.activeProfileId);
  return useMutation({
    mutationFn: (data: Omit<MoveChatToFolderInput, "profileId">) => {
      if (!profileId) throw new Error("No active User Profile");
      return api.post("/chat-folders/move-chat", { ...data, profileId });
    },
    onSuccess: () => {
      if (profileId) qc.invalidateQueries({ queryKey: chatKeys.listForProfile(profileId) });
    },
  });
}
