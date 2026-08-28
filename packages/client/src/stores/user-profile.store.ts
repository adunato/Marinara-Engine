import type { UserProfile } from "@marinara-engine/shared";
import { create } from "zustand";
import { persist } from "zustand/middleware";

interface UserProfileState {
  activeProfileId: string | null;
  activeProfile: UserProfile | null;
  isBootstrapped: boolean;
  isSwitching: boolean;
  setActiveProfileId: (id: string | null) => void;
  hydrate: (profile: UserProfile) => void;
  setSwitching: (switching: boolean) => void;
  patchActiveProfile: (patch: Partial<UserProfile>) => void;
  reset: () => void;
}

export const useUserProfileStore = create<UserProfileState>()(
  persist(
    (set) => ({
      activeProfileId: null,
      activeProfile: null,
      isBootstrapped: false,
      isSwitching: false,
      setActiveProfileId: (activeProfileId) => set({ activeProfileId }),
      hydrate: (activeProfile) => set({ activeProfile, activeProfileId: activeProfile.id, isBootstrapped: true }),
      setSwitching: (isSwitching) => set({ isSwitching }),
      patchActiveProfile: (patch) => set((state) => ({ activeProfile: state.activeProfile ? { ...state.activeProfile, ...patch } : null })),
      reset: () => set({ activeProfileId: null, activeProfile: null, isBootstrapped: false, isSwitching: false }),
    }),
    {
      name: "marinara-active-user-profile",
      partialize: (state) => ({ activeProfileId: state.activeProfileId }),
    },
  ),
);
