import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Chat, CreateUserProfileInput, PatchUserProfileContinuityInput, UserProfile } from "@marinara-engine/shared";
import { useCallback, useEffect } from "react";
import { api } from "../lib/api-client";
import { useChatStore } from "../stores/chat.store";
import { useUIStore } from "../stores/ui.store";
import { useUserProfileStore } from "../stores/user-profile.store";
import { chatKeys } from "./use-chats";
import { folderKeys } from "./use-chat-folders";
import { homeFeedKeys } from "./use-home-feed";

export const userProfileKeys = {
  all: ["user-profiles"] as const,
  list: () => [...userProfileKeys.all, "list"] as const,
};

type UserProfileContinuityPatch = Partial<PatchUserProfileContinuityInput>;

async function restoreProfileResume(profile: UserProfile, queryClient: ReturnType<typeof useQueryClient>) {
  const restoredMode = profile.lastActiveMode ?? "conversation";
  useUIStore.getState().requestChatModeShortcut(restoredMode);
  const resumeChatId = profile.lastActiveChatByMode[restoredMode];
  if (!resumeChatId) return;
  const resumeChat = await api.get<Chat>(`/chats/${resumeChatId}`).catch(() => null);
  if (resumeChat?.profileId !== profile.id || resumeChat.mode !== restoredMode) return;
  queryClient.setQueryData(chatKeys.detail(resumeChat.id), resumeChat);
  useChatStore.getState().setActiveChatId(resumeChat.id);
}

const queuedContinuityPatches = new Map<string, UserProfileContinuityPatch>();
const continuityTimers = new Map<string, ReturnType<typeof setTimeout>>();

async function flushContinuityPatch(profileId: string) {
  const timer = continuityTimers.get(profileId);
  if (timer) {
    clearTimeout(timer);
    continuityTimers.delete(profileId);
  }
  const patch = queuedContinuityPatches.get(profileId);
  if (!patch) return;
  queuedContinuityPatches.delete(profileId);
  const profile = await api.patch<UserProfile>(`/user-profiles/${profileId}`, patch);
  if (useUserProfileStore.getState().activeProfileId === profile.id) {
    useUserProfileStore.getState().hydrate(profile);
  }
}

/** Optimistically update and coalesce profile-owned continuity writes. */
export function queueActiveUserProfileContinuity(patch: UserProfileContinuityPatch) {
  const { activeProfileId, patchActiveProfile } = useUserProfileStore.getState();
  if (!activeProfileId) return;
  patchActiveProfile(patch);
  queuedContinuityPatches.set(activeProfileId, { ...queuedContinuityPatches.get(activeProfileId), ...patch });
  const existingTimer = continuityTimers.get(activeProfileId);
  if (existingTimer) clearTimeout(existingTimer);
  continuityTimers.set(
    activeProfileId,
    setTimeout(() => {
      void flushContinuityPatch(activeProfileId).catch(() => undefined);
    }, 250),
  );
}

export function useUserProfiles() {
  return useQuery({ queryKey: userProfileKeys.list(), queryFn: () => api.get<UserProfile[]>("/user-profiles"), staleTime: 5 * 60_000 });
}

export function useUserProfileBootstrap() {
  const profiles = useUserProfiles();
  const queryClient = useQueryClient();
  const activeProfileId = useUserProfileStore((state) => state.activeProfileId);
  const hydrate = useUserProfileStore((state) => state.hydrate);
  useEffect(() => {
    if (!profiles.data?.length) return;
    const selected = profiles.data.find((profile) => profile.id === activeProfileId) ?? profiles.data[0]!;
    const bootstrap = async () => {
      let profile = selected;
      const uiState = useUIStore.getState();
      const legacyContinuity = uiState.legacyUserProfileContinuity;
      if (legacyContinuity && !profile.legacyClientStateMigrated) {
        const legacyChatId = useChatStore.getState().activeChatId;
        const legacyChat = legacyChatId ? await api.get<Chat>(`/chats/${legacyChatId}`).catch(() => null) : null;
        profile = await api.post<UserProfile>(`/user-profiles/${profile.id}/migrate-legacy-client-state`, {
          ...legacyContinuity,
          ...(legacyChat && legacyChat.profileId === profile.id
            ? { lastActiveMode: legacyChat.mode, lastActiveChatId: legacyChat.id }
            : {}),
        });
        uiState.clearLegacyUserProfileContinuity();
        window.localStorage.removeItem("marinara-active-chat-id");
        queryClient.setQueryData<UserProfile[]>(userProfileKeys.list(), (items) =>
          items?.map((item) => (item.id === profile.id ? profile : item)) ?? items,
        );
      }
      hydrate(profile);
      await restoreProfileResume(profile, queryClient);
    };
    void bootstrap().catch(() => hydrate(selected));
  }, [activeProfileId, hydrate, profiles.data, queryClient]);
  return profiles;
}

export function useCreateUserProfile() {
  const queryClient = useQueryClient();
  const activePersonaId = useUserProfileStore((state) => state.activeProfile?.activePersonaId ?? null);
  return useMutation({
    mutationFn: (input: Omit<CreateUserProfileInput, "activePersonaId"> & { activePersonaId?: string | null }) =>
      api.post<UserProfile>("/user-profiles", { ...input, activePersonaId: input.activePersonaId ?? activePersonaId }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: userProfileKeys.list() }),
  });
}

export function useUpdateUserProfile() {
  const queryClient = useQueryClient();
  const patchActiveProfile = useUserProfileStore((state) => state.patchActiveProfile);
  return useMutation({
    mutationFn: ({ id, ...patch }: { id: string; name?: string } & UserProfileContinuityPatch) =>
      api.patch<UserProfile>(`/user-profiles/${id}`, patch),
    onSuccess: (profile) => {
      patchActiveProfile(profile);
      queryClient.setQueryData<UserProfile[]>(userProfileKeys.list(), (profiles) =>
        profiles?.map((item) => (item.id === profile.id ? profile : item)) ?? profiles,
      );
    },
  });
}

/** Atomically hides current history before replacing the selected profile. */
export function useSwitchUserProfile() {
  const queryClient = useQueryClient();
  const profiles = useUserProfiles();
  const hydrate = useUserProfileStore((state) => state.hydrate);
  const activeProfile = useUserProfileStore((state) => state.activeProfile);
  const setActiveProfileId = useUserProfileStore((state) => state.setActiveProfileId);
  const setSwitching = useUserProfileStore((state) => state.setSwitching);
  return useCallback(
    async (profileId: string) => {
      const target = profiles.data?.find((profile) => profile.id === profileId);
      if (!target) throw new Error("User profile not found");
      if (target.id === activeProfile?.id) return;
      setSwitching(true);
      const activeChat = useChatStore.getState().activeChat;
      const activeChatId = useChatStore.getState().activeChatId;
      if (activeProfile) {
        const lastActiveMode = activeChat?.mode ?? activeProfile.lastActiveMode;
        const lastActiveChatByMode = lastActiveMode && activeChatId
          ? { ...activeProfile.lastActiveChatByMode, [lastActiveMode]: activeChatId }
          : activeProfile.lastActiveChatByMode;
        queueActiveUserProfileContinuity({ lastActiveMode, lastActiveChatByMode });
        await flushContinuityPatch(activeProfile.id).catch(() => undefined);
      }
      useChatStore.getState().resetForProfileSwitch();
      if (activeProfile) {
        queryClient.removeQueries({ queryKey: chatKeys.listForProfile(activeProfile.id) });
        queryClient.removeQueries({ queryKey: folderKeys.listForProfile(activeProfile.id) });
        queryClient.removeQueries({ queryKey: homeFeedKeys.snapshotForProfile(activeProfile.id) });
      }
      setActiveProfileId(target.id);
      hydrate(target);
      await restoreProfileResume(target, queryClient);
      setSwitching(false);
    },
    [activeProfile, hydrate, profiles.data, queryClient, setActiveProfileId, setSwitching],
  );
}

/** Resolve ownership before changing the mounted chat surface. */
export function useProfileAwareChatNavigation() {
  const switchProfile = useSwitchUserProfile();
  const queryClient = useQueryClient();
  return useCallback(
    async (chatId: string) => {
      const chat = await api.get<Chat>(`/chats/${chatId}`);
      if (chat.profileId !== useUserProfileStore.getState().activeProfileId) await switchProfile(chat.profileId);
      queryClient.setQueryData(chatKeys.detail(chat.id), chat);
      useChatStore.getState().setActiveChatId(chat.id);
    },
    [queryClient, switchProfile],
  );
}
