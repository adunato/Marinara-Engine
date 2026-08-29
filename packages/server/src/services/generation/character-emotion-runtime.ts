import {
  normalizeCharacterEmotionProfile,
  normalizeTextForMatch,
  parseGroupedSpeakerSegments,
  stripLeadingMessageTimestamps,
  type CharacterEmotionProfile,
  type GenerationCharacterEmotionSnapshot,
} from "@marinara-engine/shared";

export type AvailableEmotionState = {
  id: string;
  label: string;
  description: string;
  spriteExpression?: string | null;
};

export type AvailableEmotionCharacter = {
  characterId: string;
  characterName: string;
  previousStateId: string;
  defaultStateId: string;
  states: AvailableEmotionState[];
};

export type CharacterEmotionEntry = {
  characterId?: unknown;
  characterName?: unknown;
  emotionStateId?: unknown;
};

export type EmotionValidationWarning = { message: string };

type MessageWithExtra = { role?: unknown; extra?: unknown };

function parseExtra(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  if (typeof value !== "string" || !value.trim()) return {};
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function profileStateIds(profile: CharacterEmotionProfile): Set<string> {
  return new Set(profile.states.map((state) => state.id));
}

/** Collect the most recent stored value per character without applying card defaults. */
export function collectLatestCharacterEmotions(messages: readonly MessageWithExtra[]): Record<string, string> {
  const result: Record<string, string> = {};
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index];
    if (!message || message.role !== "assistant") continue;
    const raw = parseExtra(message.extra).characterEmotions;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
    for (const [characterId, state] of Object.entries(raw as Record<string, unknown>)) {
      if (!(characterId in result) && typeof state === "string" && state.trim()) result[characterId] = state.trim();
    }
  }
  return result;
}

export function resolveCharacterEmotionStateMap(
  messages: readonly MessageWithExtra[],
  profilesByCharacterId: ReadonlyMap<string, CharacterEmotionProfile>,
): Record<string, string> {
  const result: Record<string, string> = {};
  const unresolved = new Set(profilesByCharacterId.keys());

  for (let index = messages.length - 1; index >= 0 && unresolved.size > 0; index--) {
    const message = messages[index];
    if (!message || message.role !== "assistant") continue;
    const raw = parseExtra(message.extra).characterEmotions;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
    const emotions = raw as Record<string, unknown>;
    for (const characterId of [...unresolved]) {
      const state = emotions[characterId];
      const profile = profilesByCharacterId.get(characterId);
      if (!profile || typeof state !== "string" || !profileStateIds(profile).has(state)) continue;
      result[characterId] = state;
      unresolved.delete(characterId);
    }
  }

  for (const characterId of unresolved) {
    const profile = profilesByCharacterId.get(characterId);
    if (profile) result[characterId] = profile.defaultStateId;
  }
  return result;
}

export function buildEmotionProfilesByCharacterId(
  characters: ReadonlyArray<{ id: string; emotionProfile?: unknown }>,
): Map<string, CharacterEmotionProfile> {
  const result = new Map<string, CharacterEmotionProfile>();
  for (const character of characters) {
    const profile = normalizeCharacterEmotionProfile(character.emotionProfile);
    if (profile?.enabled === true) result.set(character.id, profile);
  }
  return result;
}

/** Resolve the exact CR035 state and historical label that will shape a generation. */
export function resolveGenerationEmotionSnapshot(
  emotionProfile: unknown,
  persistedStateId?: string | null,
): GenerationCharacterEmotionSnapshot | null {
  const profile = normalizeCharacterEmotionProfile(emotionProfile);
  if (profile?.enabled !== true) return null;
  const selected =
    profile.states.find((state) => state.id === persistedStateId) ??
    profile.states.find((state) => state.id === profile.defaultStateId);
  if (!selected) return null;
  return { stateId: selected.id, label: selected.label };
}

/** Build generation-time emotion provenance for every enabled character profile. */
export function buildGenerationCharacterEmotionSnapshots(
  characters: ReadonlyArray<{ id: string; emotionProfile?: unknown }>,
  persistedStates: Readonly<Record<string, string>>,
): Record<string, GenerationCharacterEmotionSnapshot> {
  const result: Record<string, GenerationCharacterEmotionSnapshot> = {};
  for (const character of characters) {
    const snapshot = resolveGenerationEmotionSnapshot(character.emotionProfile, persistedStates[character.id]);
    if (snapshot) result[character.id] = snapshot;
  }
  return result;
}

export function buildAvailableEmotionCharacters(
  characters: ReadonlyArray<{ id: string; name: string; emotionProfile?: unknown }>,
  previousStates: Readonly<Record<string, string>>,
): AvailableEmotionCharacter[] {
  const result: AvailableEmotionCharacter[] = [];
  for (const character of characters) {
    const profile = normalizeCharacterEmotionProfile(character.emotionProfile);
    if (profile?.enabled !== true) continue;
    const stateIds = profileStateIds(profile);
    const previousStateId = stateIds.has(previousStates[character.id] ?? "")
      ? previousStates[character.id]!
      : profile.defaultStateId;
    result.push({
      characterId: character.id,
      characterName: character.name,
      previousStateId,
      defaultStateId: profile.defaultStateId,
      states: profile.states,
    });
  }
  return result;
}

function resolveEmotionCharacter(
  entry: CharacterEmotionEntry,
  available: readonly AvailableEmotionCharacter[],
): AvailableEmotionCharacter | null {
  const id = typeof entry.characterId === "string" ? entry.characterId.trim() : "";
  if (id) {
    const exact = available.find((character) => character.characterId === id);
    if (exact) return exact;
  }
  const name = typeof entry.characterName === "string" ? normalizeTextForMatch(entry.characterName) : "";
  if (!name) return null;
  return available.find((character) => normalizeTextForMatch(character.characterName) === name) ?? null;
}

export function validateCharacterEmotionEntries<T extends CharacterEmotionEntry>(
  entries: readonly T[] | undefined,
  available: readonly AvailableEmotionCharacter[] | undefined,
): { emotions: T[]; warnings: EmotionValidationWarning[] } {
  const warnings: EmotionValidationWarning[] = [];
  if (!Array.isArray(entries) || !Array.isArray(available)) return { emotions: [], warnings };
  const emotions: T[] = [];
  const seen = new Set<string>();

  for (const rawEntry of entries) {
    const character = resolveEmotionCharacter(rawEntry, available);
    if (!character) {
      if (rawEntry.emotionStateId !== undefined) {
        warnings.push({ message: "Emotion result referenced an unknown character - removing emotion state" });
      }
      continue;
    }
    if (typeof rawEntry.emotionStateId !== "string") continue;
    const stateId = rawEntry.emotionStateId.trim();
    if (!character.states.some((state) => state.id === stateId)) {
      warnings.push({
        message: `Expression agent chose unknown emotion "${stateId}" for ${character.characterName} - removing emotion state`,
      });
      continue;
    }
    if (seen.has(character.characterId)) {
      warnings.push({
        message: `Expression agent returned duplicate emotion for ${character.characterName} - keeping first`,
      });
      continue;
    }
    rawEntry.characterId = character.characterId;
    rawEntry.characterName = character.characterName;
    rawEntry.emotionStateId = stateId;
    emotions.push(rawEntry);
    seen.add(character.characterId);
  }
  return { emotions, warnings };
}

export function completeRequiredCharacterEmotionEntries<T extends CharacterEmotionEntry>(
  entries: readonly T[],
  available: readonly AvailableEmotionCharacter[] | undefined,
  requiredCharacterIds: readonly string[],
): T[] {
  if (!Array.isArray(available) || available.length === 0) return [...entries];
  const completed = [...entries];
  const present = new Set(
    completed.map((entry) => (typeof entry.characterId === "string" ? entry.characterId : "")).filter(Boolean),
  );
  for (const characterId of requiredCharacterIds) {
    if (present.has(characterId)) continue;
    const character = available.find((entry) => entry.characterId === characterId);
    if (!character) continue;
    completed.push({
      characterId: character.characterId,
      characterName: character.characterName,
      emotionStateId: character.previousStateId || character.defaultStateId,
    } as T);
  }
  return completed;
}

export function resolveMappedSpriteExpression(
  characterId: string,
  emotionStateId: string,
  available: readonly AvailableEmotionCharacter[] | undefined,
): string | null {
  const character = available?.find((entry) => entry.characterId === characterId);
  const state = character?.states.find((entry) => entry.id === emotionStateId);
  return state?.spriteExpression?.trim() || null;
}

export function resolveConversationAffectTargetIds(
  response: string,
  characters: ReadonlyArray<{ id: string; name: string; convoDisplayName?: string }>,
  fallbackIds: readonly string[],
): string[] {
  const aliasToId = new Map<string, string>();
  const knownNames = new Set<string>();
  for (const character of characters) {
    for (const alias of [character.name, character.convoDisplayName]) {
      if (!alias?.trim()) continue;
      const normalized = normalizeTextForMatch(alias);
      knownNames.add(normalized);
      aliasToId.set(normalized, character.id);
    }
  }
  const content = stripLeadingMessageTimestamps(response);
  const segments = parseGroupedSpeakerSegments(content, knownNames);
  if (!segments) return [...new Set(fallbackIds)];
  const ids = segments
    .map((segment) => (segment.speaker ? aliasToId.get(normalizeTextForMatch(segment.speaker)) : undefined))
    .filter((id): id is string => typeof id === "string");
  return ids.length > 0 ? [...new Set(ids)] : [...new Set(fallbackIds)];
}
