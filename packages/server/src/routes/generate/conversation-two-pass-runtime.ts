import { createHash } from "crypto";

import type { ChatMessage } from "../../services/llm/base-provider.js";
import {
  normalizeConversationBatchedSourceRequest,
  type ConversationBatchedSourceRequest,
} from "../../services/generation/conversation-context-sources.js";

function jsonObject(raw: string): Record<string, unknown> {
  const text = raw.trim().replace(/^```(?:json)?\s*/iu, "").replace(/\s*```$/u, "");
  const first = text.indexOf("{");
  const last = text.lastIndexOf("}");
  if (first < 0 || last <= first) throw new Error("Expected a JSON object.");
  const parsed = JSON.parse(text.slice(first, last + 1));
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Expected a JSON object.");
  return parsed as Record<string, unknown>;
}

export function buildConversationFastPathMessages(args: {
  prompt: string;
  previousBriefing: string;
  turnDelta: string;
}): ChatMessage[] {
  return [
    { role: "system", content: args.prompt.trim() },
    { role: "user", content: `## Existing BRIEFING\n${args.previousBriefing}\n\n## Turn Delta\n${args.turnDelta}` },
  ];
}

export function parseConversationFastPathDecision(raw: string): { fastPath: boolean; reason: string } {
  const parsed = jsonObject(raw);
  if (typeof parsed.fastPath !== "boolean") throw new Error("Fast-path decision must contain boolean fastPath.");
  return { fastPath: parsed.fastPath, reason: typeof parsed.reason === "string" ? parsed.reason.slice(0, 1000) : "" };
}

export function buildConversationSourceRequestMessages(args: {
  curatorPrompt: string;
  previousBriefing: string | null;
  turnDelta: string;
  curatedSourceKeys: readonly string[];
  forcedFull: boolean;
}): ChatMessage[] {
  return [
    { role: "system", content: args.curatorPrompt.trim() },
    {
      role: "user",
      content: [
        "This is Shot 1. Do not update the briefing yet.",
        args.forcedFull ? "A full build is required; the previous briefing is invalid and must not be reused." : "Assess which external sources are needed to update the existing briefing.",
        `Available Agent Curated source keys: ${args.curatedSourceKeys.join(", ") || "none"}.`,
        "Return JSON only: {\"query\":{\"sourceKey\":{...}},\"reason\":\"...\"}. Request only sources that may materially affect this turn.",
        args.previousBriefing ? `## Existing BRIEFING\n${args.previousBriefing}` : "## Existing BRIEFING\n(empty; full build)",
        `## Turn Delta\n${args.turnDelta}`,
      ].join("\n\n"),
    },
  ];
}

export function parseConversationSourceRequest(raw: string): ConversationBatchedSourceRequest {
  return normalizeConversationBatchedSourceRequest(jsonObject(raw));
}

export function buildConversationBriefingUpdateMessages(args: {
  curatorPrompt: string;
  mode: "fast" | "full" | "forced_full";
  previousBriefing: string | null;
  sourcesMarkdown: string;
  sourceResults?: string | null;
  turnDelta: string;
}): ChatMessage[] {
  return [
    { role: "system", content: args.curatorPrompt.trim() },
    {
      role: "user",
      content: [
        `Update mode: ${args.mode}.`,
        args.mode === "fast"
          ? "Update only Recent Exchange, Last Updated, and Emotional State when the turn clearly changes it. Preserve all other sections verbatim."
          : args.mode === "forced_full"
            ? "Build a new BRIEFING from the empty state. Do not carry forward any text from an invalidated briefing."
            : "Update only affected BRIEFING sections and preserve unchanged sections verbatim.",
        `## Immutable SOURCES\n${args.sourcesMarkdown}`,
        args.previousBriefing ? `## Existing BRIEFING\n${args.previousBriefing}` : "## Existing BRIEFING\n(empty)",
        `## Turn Delta\n${args.turnDelta}`,
        args.sourceResults ? args.sourceResults : "",
        "Return only BRIEFING content; do not include # Conversation Context Briefing or ## SOURCES.",
      ].filter(Boolean).join("\n\n"),
    },
  ];
}

export function normalizeConversationBriefing(content: string, maxOutputTokens: number): string {
  let briefing = content.trim();
  const marker = briefing.indexOf("## BRIEFING");
  if (marker >= 0) briefing = briefing.slice(marker + "## BRIEFING".length).trim();
  briefing = briefing.replace(/^# Conversation (?:Context )?Briefing\s*/iu, "").trim();
  if (!briefing) throw new Error("The Conversation context curator returned an empty briefing.");
  const maximumCharacters = Math.max(1, Math.floor(maxOutputTokens)) * 8;
  return briefing.length <= maximumCharacters ? briefing : briefing.slice(0, maximumCharacters).trimEnd();
}

export function buildConversationWriterMessages(args: {
  writerPrompt: string;
  briefing: string;
  technicalContracts?: readonly string[];
  images?: readonly string[];
  files?: ChatMessage["files"];
}): ChatMessage[] {
  const contracts = (args.technicalContracts ?? []).map((value) => value.trim()).filter(Boolean);
  const systemPrompt = [args.writerPrompt.trim(), ...contracts].filter(Boolean).join("\n\n");
  return [
    { role: "system", content: systemPrompt },
    {
      role: "user",
      content: `<conversation_briefing>\n${args.briefing}\n</conversation_briefing>`,
      ...(args.images?.length ? { images: [...args.images] } : {}),
      ...(args.files?.length ? { files: args.files.map((file) => ({ ...file })) } : {}),
    },
  ];
}

export function conversationPromptHash(messages: readonly ChatMessage[]): string {
  return createHash("sha256")
    .update(JSON.stringify(messages.map((message) => ({ role: message.role, content: message.content }))))
    .digest("hex");
}
