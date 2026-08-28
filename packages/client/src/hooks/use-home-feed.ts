import { useQuery } from "@tanstack/react-query";
import type { HomeFeedSnapshot } from "@marinara-engine/shared";
import { api } from "../lib/api-client";
import { useUserProfileStore } from "../stores/user-profile.store";

export const homeFeedKeys = {
  all: ["home-feed"] as const,
  snapshot: () => [...homeFeedKeys.all, "snapshot"] as const,
  snapshotForProfile: (profileId: string) => [...homeFeedKeys.snapshot(), profileId] as const,
};

export function useHomeFeed() {
  const profileId = useUserProfileStore((state) => state.activeProfileId);
  const ready = useUserProfileStore((state) => state.isBootstrapped && !state.isSwitching);
  return useQuery({
    queryKey: homeFeedKeys.snapshotForProfile(profileId ?? ""),
    queryFn: () => api.get<HomeFeedSnapshot>(`/chats/home-feed?profileId=${encodeURIComponent(profileId!)}`),
    enabled: !!profileId && ready,
    staleTime: 30_000,
  });
}
