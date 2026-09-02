import type { CharacterBriefingPatch, CharacterBriefingState } from "@marinara-engine/shared";
import { api } from "./api-client";

const path = (characterId: string, suffix = "") => `/characters/${encodeURIComponent(characterId)}/briefing${suffix}`;

export const characterBriefingApi = {
  get: (characterId: string) => api.get<CharacterBriefingState>(path(characterId)),
  save: (characterId: string, patch: CharacterBriefingPatch) =>
    api.patch<CharacterBriefingState>(path(characterId), patch),
  generate: (characterId: string) => api.post<CharacterBriefingState>(path(characterId, "/generate")),
};
