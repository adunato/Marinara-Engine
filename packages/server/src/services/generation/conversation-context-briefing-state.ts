import {
  CONVERSATION_CONTEXT_SOURCE_KEYS,
  type ConversationContextBriefingState,
  type ConversationContextSourceKey,
  type ConversationContextSourceRoleMap,
} from "@marinara-engine/shared";
import { resolveConversationTimeZone, zonedLogicalDateKey } from "../conversation/timezone.js";

const turnLocks = new Map<string, Promise<void>>();

export async function withConversationBriefingTurnLock<T>(chatId: string, operation: () => Promise<T>): Promise<T> {
  const previous = turnLocks.get(chatId) ?? Promise.resolve();
  const queued = previous.catch(() => undefined).then(operation);
  const sentinel = queued.then(() => undefined, () => undefined);
  turnLocks.set(chatId, sentinel);
  try {
    return await queued;
  } finally {
    if (turnLocks.get(chatId) === sentinel) turnLocks.delete(chatId);
  }
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

export function normalizeConversationBriefingState(value: unknown): ConversationContextBriefingState | null {
  const raw = record(value);
  const revision = Math.floor(Number(raw.revision));
  const contributingSources = Array.isArray(raw.contributingSources)
    ? raw.contributingSources.filter((key): key is ConversationContextSourceKey =>
        CONVERSATION_CONTEXT_SOURCE_KEYS.includes(key as ConversationContextSourceKey),
      )
    : [];
  if (
    raw.schemaVersion !== 1 ||
    typeof raw.logicalDayKey !== "string" ||
    !raw.logicalDayKey ||
    !Number.isFinite(revision) ||
    revision < 1 ||
    typeof raw.updatedAt !== "string" ||
    !Number.isFinite(Date.parse(raw.updatedAt))
  ) {
    return null;
  }
  return {
    schemaVersion: 1,
    logicalDayKey: raw.logicalDayKey,
    revision,
    updatedAt: new Date(raw.updatedAt).toISOString(),
    contributingSources,
  };
}

export function conversationBriefingLogicalDayKey(metadata: Record<string, unknown>, now = new Date()): string {
  const rolloverRaw = Math.floor(Number(metadata.dayRolloverHour));
  const rolloverHour = Number.isFinite(rolloverRaw) ? Math.max(0, Math.min(11, rolloverRaw)) : 4;
  return zonedLogicalDateKey(now, resolveConversationTimeZone(metadata), rolloverHour);
}

export function splitConversationBriefingArtifact(artifact: unknown): { sources: string; briefing: string } | null {
  if (typeof artifact !== "string" || !artifact.trim()) return null;
  const sourceMarker = "## SOURCES";
  const briefingMarker = "## BRIEFING";
  const sourceAt = artifact.indexOf(sourceMarker);
  const briefingAt = artifact.indexOf(briefingMarker);
  if (sourceAt < 0 || briefingAt <= sourceAt) return null;
  const sources = artifact.slice(sourceAt + sourceMarker.length, briefingAt).trim();
  const briefing = artifact.slice(briefingAt + briefingMarker.length).trim();
  return briefing ? { sources, briefing } : null;
}

export function assembleConversationBriefingArtifact(sources: string, briefing: string): string {
  const body = briefing.trim().replace(/^## BRIEFING\s*/iu, "").trim();
  if (!body) throw new Error("Conversation curator returned an empty BRIEFING section.");
  return `# Conversation Context Briefing\n\n## SOURCES\n${sources.trim() || "(No Always Include source content available.)"}\n\n## BRIEFING\n${body}`;
}

export function conversationBriefingNeedsFullBuild(args: {
  metadata: Record<string, unknown>;
  roles: ConversationContextSourceRoleMap;
  availableSources: ReadonlySet<ConversationContextSourceKey>;
  now?: Date;
}): { required: boolean; reason: string; state: ConversationContextBriefingState | null; briefing: string | null } {
  const artifact = typeof args.metadata.conversationContextBriefing === "string"
    ? args.metadata.conversationContextBriefing
    : null;
  const split = splitConversationBriefingArtifact(artifact);
  const state = normalizeConversationBriefingState(args.metadata.conversationContextBriefingState);
  if (!split || !state) return { required: true, reason: "missing_or_invalid", state, briefing: null };
  const logicalDayKey = conversationBriefingLogicalDayKey(args.metadata, args.now);
  if (state.logicalDayKey !== logicalDayKey) return { required: true, reason: "logical_day_rollover", state, briefing: null };
  for (const key of state.contributingSources) {
    if (args.roles[key] === "always_exclude" || !args.availableSources.has(key)) {
      return { required: true, reason: `source_invalidated:${key}`, state, briefing: null };
    }
  }
  return { required: false, reason: "valid", state, briefing: split.briefing };
}

export function buildConversationBriefingMetadataPatch(args: {
  metadata: Record<string, unknown>;
  artifact: string;
  contributingSources: ConversationContextSourceKey[];
  now?: Date;
}): Record<string, unknown> {
  const previous = normalizeConversationBriefingState(args.metadata.conversationContextBriefingState);
  const now = args.now ?? new Date();
  return {
    conversationContextBriefing: args.artifact,
    conversationContextBriefingState: {
      schemaVersion: 1,
      logicalDayKey: conversationBriefingLogicalDayKey(args.metadata, now),
      revision: (previous?.revision ?? 0) + 1,
      updatedAt: now.toISOString(),
      contributingSources: Array.from(new Set(args.contributingSources)),
    } satisfies ConversationContextBriefingState,
  };
}

export function clearConversationBriefingMetadataPatch(): Record<string, unknown> {
  return { conversationContextBriefing: null, conversationContextBriefingState: null };
}
