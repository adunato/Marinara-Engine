import {
  CONVERSATION_CONTEXT_SOURCE_KEYS,
  normalizeConversationContextSourceRoles,
  type ConversationContextSourceKey,
  type ConversationContextSourceRoleMap,
  type ConversationContextSourceStatus,
} from "@marinara-engine/shared";
import type { ChatMessage } from "../llm/base-provider.js";

export interface ConversationResolvedSource {
  key: ConversationContextSourceKey;
  content: string;
  images: string[];
  files: NonNullable<ChatMessage["files"]>;
}

export interface ConversationBatchedSourceRequest {
  query: Partial<Record<ConversationContextSourceKey, unknown>>;
  reason?: string;
}

const SOURCE_META: Record<ConversationContextSourceKey, { label: string; description: string; patterns: RegExp[] }> = {
  characterCard: { label: "Character Card", description: "Participating character identity, profile and card context.", patterns: [/character[_ ]info/iu, /character card/iu, /personality/iu, /scenario/iu] },
  persona: { label: "Persona", description: "The active user persona and Conversation profile context.", patterns: [/<persona/iu, /user persona/iu, /persona[_ ]info/iu, /about me/iu] },
  conversationStatus: { label: "Conversation Status", description: "Current time, presence, status, activity, schedules and situational context.", patterns: [/<context>/iu, /current context/iu, /current status/iu, /current activity/iu, /autonomous intent/iu, /schedule/iu] },
  commands: { label: "Commands", description: "Conversation command contracts and reminders.", patterns: [/<commands>/iu, /^## Commands/mu, /available commands/iu] },
  reactRules: { label: "Emoji / React Rules", description: "Custom emoji, sticker and reaction rules.", patterns: [/react rules/iu, /custom emoji/iu, /custom sticker/iu] },
  replyRules: { label: "Reply Rules", description: "Reply advertisement and reply-format guidance.", patterns: [/reply rules/iu, /reply advertisement/iu] },
  memories: { label: "Character Memories", description: "Embedding-recalled earlier Conversation fragments.", patterns: [/<memories>/iu, /recalled fragments from earlier/iu, /--- Memory \d+/iu] },
  dailyMemories: { label: "Daily Memories", description: "Durable Daily Conversation Memories relevant to the turn.", patterns: [/daily conversation memories/iu, /<daily_memor/iu] },
  dailyIntentions: { label: "Daily Intentions", description: "Current first-person Daily Intentions.", patterns: [/<daily_intentions>/iu, /daily intentions/iu] },
  lorebook: { label: "Lorebook", description: "Lore entries active for the current Conversation context.", patterns: [/<lore/iu, /lorebook/iu, /^## Lore/mu] },
  summaries: { label: "Conversation Summaries", description: "Rolling, daily and weekly Conversation summaries.", patterns: [/rolling summary/iu, /weekly summary/iu, /daily summary/iu, /conversation summaries/iu] },
  crossChatAwareness: { label: "Cross-Chat Awareness", description: "Context from other Conversations sharing the current character.", patterns: [/cross chat awareness/iu, /cross-chat awareness/iu, /source conversation/iu] },
  roleplayScenes: { label: "Roleplay Source Chats", description: "Explicitly linked Conversation, Roleplay or Game source-chat context.", patterns: [/<roleplay_context_sources>/iu, /source_chat mode=/iu] },
  characterMind: { label: "Character Mind", description: "Read-only Character Mind wiki/query context.", patterns: [/character mind/iu, /mind_search/iu, /mind_read/iu] },
  recentExchange: { label: "Recent Exchange", description: "Recent visible user/assistant exchange for tone and continuity.", patterns: [] },
};

function cloneMessage(message: ChatMessage, sourceScaffold: string): ChatMessage {
  const content = sourceScaffold ? message.content.split(sourceScaffold).join("").trim() : message.content.trim();
  return {
    ...message,
    content,
    ...(message.images?.length ? { images: [...message.images] } : {}),
    ...(message.files?.length ? { files: message.files.map((file) => ({ ...file })) } : {}),
  };
}

function appendSource(map: Map<ConversationContextSourceKey, ConversationResolvedSource>, key: ConversationContextSourceKey, message: ChatMessage) {
  if (!message.content.trim() && !message.images?.length && !message.files?.length) return;
  const existing = map.get(key);
  const content = existing?.content ? `${existing.content}\n\n${message.content}`.trim() : message.content.trim();
  map.set(key, {
    key,
    content,
    images: [...(existing?.images ?? []), ...(message.images ?? [])],
    files: [...(existing?.files ?? []), ...(message.files ?? [])],
  });
}

export function extractConversationContextSources(
  preparedMessages: readonly ChatMessage[],
  sourceScaffold: string,
  sourceOverrides?: ReadonlyMap<ConversationContextSourceKey, ConversationResolvedSource>,
): Map<ConversationContextSourceKey, ConversationResolvedSource> {
  const result = new Map<ConversationContextSourceKey, ConversationResolvedSource>();
  const messages = preparedMessages.map((message) => cloneMessage(message, sourceScaffold));
  const exchange = messages
    .filter((message) => (message.role === "user" || message.role === "assistant") && message.content.trim())
    .slice(-12);
  if (exchange.length) {
    result.set("recentExchange", {
      key: "recentExchange",
      content: exchange.map((message) => `${message.role.toUpperCase()}: ${message.content}`).join("\n\n"),
      images: exchange.flatMap((message) => message.images ?? []),
      files: exchange.flatMap((message) => message.files ?? []),
    });
  }

  const leadingSystem = messages.filter((message) => message.role === "system" && message.content.trim());
  for (const message of leadingSystem) {
    for (const key of CONVERSATION_CONTEXT_SOURCE_KEYS) {
      if (key === "recentExchange") continue;
      const meta = SOURCE_META[key];
      if (meta.patterns.some((pattern) => pattern.test(message.content))) appendSource(result, key, message);
    }
  }

  // The canonical Conversation prompt may combine card/persona material into a leading
  // system block without source-specific tags. Keep that material inside the explicit
  // registry rather than falling back to an unbounded CR032 snapshot.
  if (!result.has("characterCard") && leadingSystem[0]) appendSource(result, "characterCard", leadingSystem[0]);
  if (!result.has("persona") && leadingSystem[1]) appendSource(result, "persona", leadingSystem[1]);

  for (const [key, source] of sourceOverrides ?? []) result.set(key, source);
  return result;
}

export function conversationContextSourceStatuses(
  metadata: Record<string, unknown>,
  availableKeys?: ReadonlySet<ConversationContextSourceKey>,
): ConversationContextSourceStatus[] {
  const roles = normalizeConversationContextSourceRoles(metadata.conversationContextSourceRoles);
  return CONVERSATION_CONTEXT_SOURCE_KEYS.map((key) => {
    const knownUnavailable = availableKeys ? !availableKeys.has(key) : false;
    return {
      key,
      label: SOURCE_META[key].label,
      description: SOURCE_META[key].description,
      role: roles[key],
      available: !knownUnavailable,
      unavailableReason: knownUnavailable ? "No content is currently available for this source." : null,
    };
  });
}

export function renderConversationAlwaysIncludeSources(
  sources: ReadonlyMap<ConversationContextSourceKey, ConversationResolvedSource>,
  roles: ConversationContextSourceRoleMap,
): { markdown: string; keys: ConversationContextSourceKey[]; images: string[]; files: NonNullable<ChatMessage["files"]> } {
  const blocks: string[] = [];
  const keys: ConversationContextSourceKey[] = [];
  const images: string[] = [];
  const files: NonNullable<ChatMessage["files"]> = [];
  for (const key of CONVERSATION_CONTEXT_SOURCE_KEYS) {
    if (roles[key] !== "always_include") continue;
    const source = sources.get(key);
    if (!source) continue;
    keys.push(key);
    blocks.push(`### ${SOURCE_META[key].label}\n${source.content || "(attachment-only source)"}`);
    images.push(...source.images);
    files.push(...source.files);
  }
  return { markdown: blocks.join("\n\n"), keys, images, files };
}

export function normalizeConversationBatchedSourceRequest(value: unknown): ConversationBatchedSourceRequest {
  const raw = value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
  const queryRaw = raw.query && typeof raw.query === "object" && !Array.isArray(raw.query)
    ? (raw.query as Record<string, unknown>)
    : {};
  const query: Partial<Record<ConversationContextSourceKey, unknown>> = {};
  for (const key of CONVERSATION_CONTEXT_SOURCE_KEYS) {
    if (Object.prototype.hasOwnProperty.call(queryRaw, key)) query[key] = queryRaw[key];
  }
  return { query, reason: typeof raw.reason === "string" ? raw.reason.slice(0, 1000) : undefined };
}

export async function executeConversationBatchedSourceRequest(args: {
  request: ConversationBatchedSourceRequest;
  sources: ReadonlyMap<ConversationContextSourceKey, ConversationResolvedSource>;
  roles: ConversationContextSourceRoleMap;
  resolveCuratedSource?: (
    key: ConversationContextSourceKey,
    request: unknown,
  ) => Promise<ConversationResolvedSource | null | undefined>;
}): Promise<{ markdown: string; returnedKeys: ConversationContextSourceKey[] }> {
  const blocks: string[] = [];
  const returnedKeys: ConversationContextSourceKey[] = [];
  for (const key of CONVERSATION_CONTEXT_SOURCE_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(args.request.query, key)) continue;
    if (args.roles[key] !== "agent_curated") continue;
    const dynamicallyResolved = args.resolveCuratedSource
      ? await args.resolveCuratedSource(key, args.request.query[key])
      : undefined;
    const source = dynamicallyResolved === undefined ? args.sources.get(key) : dynamicallyResolved;
    if (!source) {
      blocks.push(`### ${SOURCE_META[key].label}\nUnavailable for this turn.`);
      continue;
    }
    returnedKeys.push(key);
    blocks.push(`### ${SOURCE_META[key].label}\n${source.content || "(attachment-only source)"}`);
  }
  return { markdown: blocks.length ? `## Source Results\n\n${blocks.join("\n\n")}` : "## Source Results\n\n(No Agent Curated sources requested or available.)", returnedKeys };
}
