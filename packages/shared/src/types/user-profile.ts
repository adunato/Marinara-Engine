import type { ChatMode } from "./chat.js";

/** Fixed id allocated to the profile created while upgrading a legacy installation. */
export const DEFAULT_USER_PROFILE_ID = "default";

export type UserStatus = "active" | "idle" | "dnd" | "invisible";

export interface GameSetupLearnedOptions {
  genres: string[];
  tones: string[];
  settings: string[];
  goals: string[];
  preferences: string[];
}

export interface GameSetupRememberedText {
  playerGoals: string;
  preferences: string;
}

export const EMPTY_GAME_SETUP_LEARNED_OPTIONS: GameSetupLearnedOptions = {
  genres: [],
  tones: [],
  settings: [],
  goals: [],
  preferences: [],
};

export const EMPTY_GAME_SETUP_REMEMBERED_TEXT: GameSetupRememberedText = {
  playerGoals: "",
  preferences: "",
};

/**
 * A history namespace. It intentionally contains only conversational continuity;
 * reusable content and application settings remain installation-global.
 */
export interface UserProfile {
  id: string;
  name: string;
  activePersonaId: string | null;
  lastActiveMode: ChatMode | null;
  lastActiveChatByMode: Partial<Record<ChatMode, string>>;
  userStatusManual: UserStatus;
  userStatus: UserStatus;
  userActivity: string;
  recentUserActivities: string[];
  learnedGameSetupOptions: GameSetupLearnedOptions;
  rememberedGameSetupText: GameSetupRememberedText;
  legacyClientStateMigrated: boolean;
  createdAt: string;
  updatedAt: string;
}
