import type { GenerationCharacterEmotionSnapshot } from "@marinara-engine/shared";

type MessageWithExtra = { extra?: unknown };

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

export function resolveMessageGenerationEmotion(
  message: MessageWithExtra,
  characterId: string | null | undefined,
): GenerationCharacterEmotionSnapshot | null {
  if (!characterId?.trim()) return null;
  const rawMap = parseExtra(message.extra).generationCharacterEmotions;
  if (!rawMap || typeof rawMap !== "object" || Array.isArray(rawMap)) return null;
  const raw = (rawMap as Record<string, unknown>)[characterId];
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const record = raw as Record<string, unknown>;
  const rawStateId = record.stateId;
  const rawLabel = record.label;
  const stateId = typeof rawStateId === "string" ? rawStateId.trim() : "";
  const label = typeof rawLabel === "string" ? rawLabel.trim() : "";
  if (!stateId || !label) return null;
  return { stateId, label };
}

export function resolveMessageGenerationEmotionLabel(
  message: MessageWithExtra,
  characterId: string | null | undefined,
): string | null {
  return resolveMessageGenerationEmotion(message, characterId)?.label ?? null;
}
