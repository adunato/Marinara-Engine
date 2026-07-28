import {
  DAILY_INTENTION_AREA_KEYS,
  DAILY_INTENTIONS_AGENT_ID,
  DEFAULT_DAILY_INTENTION_AREAS,
  type DailyIntentionAreaConfig,
  type DailyIntentionAreaKey,
  type DailyIntentionOutput,
  type DailyIntentionsSettings,
  type DailyIntentionsState,
} from "@marinara-engine/shared";

import type { BaseLLMProvider, ChatMessage } from "../llm/base-provider.js";

const GENERATION_TIMEOUT_MS = 300_000;
const MAX_HEADING_LENGTH = 120;
const MAX_PROMPT_LENGTH = 50_000;
const MAX_OUTPUT_LENGTH = 20_000;

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}
function boundedText(value: unknown, fallback: string, maxLength: number): string {
  if (typeof value !== "string") return fallback;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, maxLength) : fallback;
}

function areaDefaults(key: DailyIntentionAreaKey) {
  return DEFAULT_DAILY_INTENTION_AREAS.find((area) => area.key === key)!;
}

export function defaultDailyIntentionsSettings(): DailyIntentionsSettings {
  return {
    connectionId: null,
    cutoffHour: 4,
    areas: DAILY_INTENTION_AREA_KEYS.map((key) => {
      const defaults = areaDefaults(key);
      return {
        key,
        heading: defaults.heading,
        prompt: defaults.prompt,
        enabled: defaults.enabled,
      };
    }),
  };
}

export function normalizeDailyIntentionsSettings(value: unknown): DailyIntentionsSettings {
  const source = record(value);
  const inputAreas = Array.isArray(source.areas) ? source.areas : [];
  const byKey = new Map<DailyIntentionAreaKey, Record<string, unknown>>();
  for (const candidate of inputAreas) {
    const parsed = record(candidate);
    if (DAILY_INTENTION_AREA_KEYS.includes(parsed.key as DailyIntentionAreaKey)) {
      byKey.set(parsed.key as DailyIntentionAreaKey, parsed);
    }
  }

  const cutoff = Math.floor(Number(source.cutoffHour));
  return {
    connectionId:
      typeof source.connectionId === "string" && source.connectionId.trim() ? source.connectionId.trim() : null,
    cutoffHour: Number.isFinite(cutoff) ? Math.max(0, Math.min(23, cutoff)) : 4,
    areas: DAILY_INTENTION_AREA_KEYS.map((key) => {
      const defaults = areaDefaults(key);
      const candidate = byKey.get(key) ?? {};
      return {
        key,
        heading: boundedText(candidate.heading, defaults.heading, MAX_HEADING_LENGTH),
        prompt: boundedText(candidate.prompt, defaults.prompt, MAX_PROMPT_LENGTH),
        enabled: candidate.enabled !== false,
      };
    }),
  };
}

export function normalizeDailyIntentionsState(value: unknown): DailyIntentionsState {
  const source = record(value);
  const rawOutputs = record(source.outputs);
  const outputs: Partial<Record<DailyIntentionAreaKey, DailyIntentionOutput>> = {};
  for (const key of DAILY_INTENTION_AREA_KEYS) {
    const candidate = record(rawOutputs[key]);
    const content = typeof candidate.content === "string" ? candidate.content.trim().slice(0, MAX_OUTPUT_LENGTH) : "";
    if (!content) continue;
    outputs[key] = {
      key,
      content,
      updatedAt:
        typeof candidate.updatedAt === "string" && !Number.isNaN(Date.parse(candidate.updatedAt))
          ? candidate.updatedAt
          : new Date(0).toISOString(),
    };
  }
  return { settings: normalizeDailyIntentionsSettings(source.settings), outputs };
}

export function isDailyIntentionsAgentActive(metadata: Record<string, unknown>): boolean {
  return (
    metadata.enableAgents === true &&
    Array.isArray(metadata.activeAgentIds) &&
    metadata.activeAgentIds.includes(DAILY_INTENTIONS_AGENT_ID)
  );
}

export function dailyIntentionsEligibility(characterIds: string[]): { eligible: boolean; error: string | null } {
  if (characterIds.length === 1) return { eligible: true, error: null };
  return {
    eligible: false,
    error: "Daily Intentions currently supports Conversations with exactly one character.",
  };
}

export function findDailyIntentionArea(
  settings: DailyIntentionsSettings,
  key: unknown,
): DailyIntentionAreaConfig | null {
  if (!DAILY_INTENTION_AREA_KEYS.includes(key as DailyIntentionAreaKey)) return null;
  return settings.areas.find((area) => area.key === key) ?? null;
}

export function replaceDailyIntentionOutput(
  state: DailyIntentionsState,
  key: DailyIntentionAreaKey,
  content: string,
  updatedAt = new Date().toISOString(),
): DailyIntentionsState {
  const normalizedContent = content.trim().slice(0, MAX_OUTPUT_LENGTH);
  const outputs = { ...state.outputs };
  if (normalizedContent) outputs[key] = { key, content: normalizedContent, updatedAt };
  else delete outputs[key];
  return { settings: state.settings, outputs };
}

export function buildDailyIntentionsContextBlock(
  state: DailyIntentionsState,
  characterName: string,
): string | null {
  const entries = state.settings.areas.flatMap((area) => {
    const output = state.outputs[area.key];
    if (!area.enabled || !output?.content.trim()) return [];
    return [`### ${area.heading}`, output.content.trim()];
  });
  if (entries.length === 0) return null;
  return [
    "<daily_intentions>",
    `These are ${characterName}'s current first-person intentions. They are provisional intentions, not completed events or factual memories.`,
    ...entries,
    "</daily_intentions>",
  ].join("\n");
}

export function stripDailyIntentionsContext(content: string): string {
  return content.replace(/\s*<daily_intentions>[\s\S]*?<\/daily_intentions>\s*/giu, "\n\n").trim();
}

function cleanModelOutput(value: string): string {
  let output = value.trim();
  const fenced = output.match(/^```(?:markdown|md|text)?\s*\n([\s\S]*?)\n```$/iu);
  if (fenced) output = fenced[1]!.trim();
  output = output.replace(/^#{1,6}\s+[^\n]+\n+/u, "").trim();
  if (!output) throw new Error("The model returned an empty Daily Intention");
  return output.slice(0, MAX_OUTPUT_LENGTH);
}

async function withTimeout<T>(promise: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("Daily Intention generation timed out")), GENERATION_TIMEOUT_MS);
        timer.unref?.();
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function generateDailyIntention(options: {
  provider: BaseLLMProvider;
  model: string;
  area: DailyIntentionAreaConfig;
  characterName: string;
  contextMessages: ChatMessage[];
  signal?: AbortSignal;
}): Promise<string> {
  const context = options.contextMessages
    .map((message) => `${message.role.toUpperCase()}:\n${stripDailyIntentionsContext(message.content)}`)
    .filter((value) => value.trim())
    .join("\n\n");
  const result = await withTimeout(
    options.provider.chatComplete(
      [
        { role: "system", content: options.area.prompt },
        {
          role: "user",
          content: [
            `The following is the current comprehensive context for ${options.characterName}. Treat it as reference material, not as a request to answer the last chat message.`,
            "<daily_intention_context>",
            context,
            "</daily_intention_context>",
            `Generate ${options.characterName}'s current intention for the configured area now.`,
          ].join("\n\n"),
        },
      ],
      {
        model: options.model,
        temperature: 0.7,
        maxTokens: 2048,
        maxContext: options.provider.maxContextValue ?? undefined,
        signal: options.signal,
      },
    ),
  );
  return cleanModelOutput(result.content ?? "");
}
