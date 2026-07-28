export const DAILY_INTENTION_AREA_KEYS = ["work_study", "friendships", "romance", "sex"] as const;

export type DailyIntentionAreaKey = (typeof DAILY_INTENTION_AREA_KEYS)[number];

export interface DailyIntentionAreaConfig {
  key: DailyIntentionAreaKey;
  heading: string;
  prompt: string;
  enabled: boolean;
}
export interface DailyIntentionOutput {
  key: DailyIntentionAreaKey;
  content: string;
  updatedAt: string;
}

export interface DailyIntentionsSettings {
  connectionId: string | null;
  cutoffHour: number;
  areas: DailyIntentionAreaConfig[];
}

export interface DailyIntentionsState {
  settings: DailyIntentionsSettings;
  outputs: Partial<Record<DailyIntentionAreaKey, DailyIntentionOutput>>;
}

export interface DailyIntentionsResponse {
  active: boolean;
  eligible: boolean;
  eligibilityError: string | null;
  characterId: string | null;
  characterName: string | null;
  settings: DailyIntentionsSettings;
  outputs: Partial<Record<DailyIntentionAreaKey, DailyIntentionOutput>>;
}

export interface DailyIntentionRunResult {
  key: DailyIntentionAreaKey;
  output: DailyIntentionOutput | null;
  error: string | null;
}
