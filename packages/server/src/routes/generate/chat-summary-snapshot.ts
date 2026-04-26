import type { ChatSummarySnapshot, ChatSummarySnapshotSource } from "@marinara-engine/shared";

type MessageLike = {
  id?: string | null;
  createdAt?: string | null;
};

type SummaryAnchor = {
  messageId: string | null;
  messageCreatedAt: string | null;
  coveredMessageCount: number;
};

const MAX_PREVIOUS_SUMMARY_ANCHORS = 10;

function isObject(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

function normalizeSnapshot(value: unknown): ChatSummarySnapshot | null {
  if (!isObject(value)) return null;
  const source = value.source;
  if (source !== "built_in_agent" && source !== "manual_generate" && source !== "append_chat_summary_tool") {
    return null;
  }
  const anchorMessageId = typeof value.anchorMessageId === "string" ? value.anchorMessageId : null;
  const anchorMessageCreatedAt =
    typeof value.anchorMessageCreatedAt === "string" ? value.anchorMessageCreatedAt : null;
  const updatedAt = typeof value.updatedAt === "string" ? value.updatedAt : new Date().toISOString();
  const previousAnchors = Array.isArray(value.previousAnchors)
    ? value.previousAnchors
        .filter((anchor): anchor is Record<string, unknown> => isObject(anchor))
        .map((anchor) => ({
          messageId: typeof anchor.messageId === "string" ? anchor.messageId : "",
          messageCreatedAt: typeof anchor.messageCreatedAt === "string" ? anchor.messageCreatedAt : null,
          updatedAt: typeof anchor.updatedAt === "string" ? anchor.updatedAt : updatedAt,
        }))
        .filter((anchor) => anchor.messageId)
        .slice(0, MAX_PREVIOUS_SUMMARY_ANCHORS)
    : [];

  return {
    source,
    updatedAt,
    anchorMessageId,
    anchorMessageCreatedAt,
    previousAnchors,
    coveredMessageCount:
      typeof value.coveredMessageCount === "number" && Number.isFinite(value.coveredMessageCount)
        ? Math.max(0, Math.trunc(value.coveredMessageCount))
        : 0,
    summaryLength:
      typeof value.summaryLength === "number" && Number.isFinite(value.summaryLength)
        ? Math.max(0, Math.trunc(value.summaryLength))
        : 0,
  };
}

export function createSummaryAnchor(messages: MessageLike[], preferredMessage?: MessageLike | null): SummaryAnchor {
  const anchorMessage = preferredMessage?.id ? preferredMessage : messages[messages.length - 1];
  return {
    messageId: anchorMessage?.id ?? null,
    messageCreatedAt: anchorMessage?.createdAt ?? null,
    coveredMessageCount: messages.length,
  };
}

export function buildSummarySnapshotPatch(args: {
  currentMeta: Record<string, unknown>;
  summary: string;
  source: ChatSummarySnapshotSource;
  anchor: SummaryAnchor;
  now?: string;
}): { summary: string; chatSummarySnapshot: ChatSummarySnapshot } {
  const previous = normalizeSnapshot(args.currentMeta.chatSummarySnapshot);
  const updatedAt = args.now ?? new Date().toISOString();
  const previousAnchors = previous?.previousAnchors ? [...previous.previousAnchors] : [];

  if (previous?.anchorMessageId) {
    previousAnchors.unshift({
      messageId: previous.anchorMessageId,
      messageCreatedAt: previous.anchorMessageCreatedAt,
      updatedAt: previous.updatedAt,
    });
  }

  const seen = new Set<string>();
  const dedupedPreviousAnchors = previousAnchors
    .filter((anchor) => {
      if (!anchor.messageId || seen.has(anchor.messageId) || anchor.messageId === args.anchor.messageId) return false;
      seen.add(anchor.messageId);
      return true;
    })
    .slice(0, MAX_PREVIOUS_SUMMARY_ANCHORS);

  return {
    summary: args.summary,
    chatSummarySnapshot: {
      source: args.source,
      updatedAt,
      anchorMessageId: args.anchor.messageId,
      anchorMessageCreatedAt: args.anchor.messageCreatedAt,
      previousAnchors: dedupedPreviousAnchors,
      coveredMessageCount: args.anchor.coveredMessageCount,
      summaryLength: args.summary.length,
    },
  };
}

export function resolveChatSummaryTrimIndex(
  messages: MessageLike[],
  snapshotValue: unknown,
): { trimIndex: number; source: "current" | "previous" | "timestamp" } | null {
  const snapshot = normalizeSnapshot(snapshotValue);
  if (!snapshot || messages.length === 0) return null;

  if (snapshot.anchorMessageId) {
    const currentIndex = messages.findIndex((message) => message.id === snapshot.anchorMessageId);
    if (currentIndex >= 0) return { trimIndex: currentIndex + 1, source: "current" };
  }

  for (const anchor of snapshot.previousAnchors) {
    const previousIndex = messages.findIndex((message) => message.id === anchor.messageId);
    if (previousIndex >= 0) return { trimIndex: previousIndex + 1, source: "previous" };
  }

  const timestamps = [
    snapshot.anchorMessageCreatedAt,
    ...snapshot.previousAnchors.map((anchor) => anchor.messageCreatedAt),
  ].filter((timestamp): timestamp is string => typeof timestamp === "string" && timestamp.length > 0);

  for (const timestamp of timestamps) {
    const firstAfter = messages.findIndex((message) => {
      return typeof message.createdAt === "string" && message.createdAt > timestamp;
    });
    if (firstAfter > 0) return { trimIndex: firstAfter, source: "timestamp" };
  }

  return null;
}

export function applyChatSummaryContextTrim<T extends MessageLike>(
  messages: T[],
  metadata: Record<string, unknown>,
): T[] {
  if (metadata.trimAfterChatSummary !== true) return messages;
  const resolved = resolveChatSummaryTrimIndex(messages, metadata.chatSummarySnapshot);
  if (!resolved) return messages;
  if (resolved.trimIndex <= 0 || resolved.trimIndex >= messages.length) return messages;
  return messages.slice(resolved.trimIndex);
}

export function remapChatSummarySnapshotForBranch(
  snapshotValue: unknown,
  messageIdMap: Map<string, string>,
): ChatSummarySnapshot | null {
  const snapshot = normalizeSnapshot(snapshotValue);
  if (!snapshot) return null;

  const mappedPreviousAnchors = snapshot.previousAnchors
    .map((anchor) => {
      const mappedId = messageIdMap.get(anchor.messageId);
      return mappedId ? { ...anchor, messageId: mappedId } : null;
    })
    .filter((anchor): anchor is NonNullable<typeof anchor> => anchor != null);

  if (snapshot.anchorMessageId) {
    const mappedCurrentId = messageIdMap.get(snapshot.anchorMessageId);
    if (mappedCurrentId) {
      return {
        ...snapshot,
        anchorMessageId: mappedCurrentId,
        previousAnchors: mappedPreviousAnchors,
      };
    }
  }

  const promoted = mappedPreviousAnchors[0];
  if (!promoted) return null;

  return {
    ...snapshot,
    anchorMessageId: promoted.messageId,
    anchorMessageCreatedAt: promoted.messageCreatedAt,
    previousAnchors: mappedPreviousAnchors.slice(1),
  };
}
