# Title: Chat Summary Auto Trim

## Status

Draft

## Baseline

This CR branch starts from the local `upstream-main` branch and includes a merge of `change/CR004-custom-chat-summary-agent`.

While preparing the branch, `upstream-main` could not be fast-forwarded to `upstream/main` because the local branch has fork PR commits that are not present upstream, and `upstream/main` has one newer commit. The local `upstream-main` branch was left unchanged.

## Background

CR004 enabled custom chat memory agents through `read_chat_summary` and `append_chat_summary`, while preserving the built-in Chat Summary agent and the manual Generate button in the Chat Summary popover. That CR explicitly left summary-aware context trimming out of scope.

The current context limit setting can send only the last N messages to the model, but it is a fixed manual ceiling and is not connected to memory freshness. Once a chat summary has captured older conversation history, users should be able to stop sending the summarized messages to the model while still sending new messages after the last trusted Chat Summary update.

## Problem Statement

Users can currently limit prompt context only by choosing a fixed message count. That setting does not know whether the chat summary has already captured older messages, so it can either keep sending summarized history unnecessarily or exclude too much recent unsummarized conversation.

The desired behavior is an optional context-trimming mode that uses Chat Summary freshness: summarized history becomes the lower bound, and the existing fixed message limit remains available as an upper bound. In this CR, "trim" means excluding messages from the LLM request context. It does not mean deleting persisted chat messages.

To make that behavior reliable, summary updates need to record enough state to identify the last valid message covered by a trusted summary update. That marker is an implementation requirement for the context trimming behavior, not an end-user feature by itself.

The marker must be maintained only by system-managed summary writes:

- built-in Chat Summary agent updates during generation;
- the Generate button in the Chat Summary popover;
- `append_chat_summary` tool calls from custom memory agents introduced by CR004.

Manual edits to the summary text must not advance the marker, because the system cannot know which messages the user considered while editing.

## Goals

- Record a durable Chat Summary snapshot marker whenever an automated or tool-driven summary update succeeds.
- Use that marker to support an optional Context Limit mode that sends only messages after the last Chat Summary update.
- Keep the marker robust when messages are deleted, bulk-deleted, regenerated, or branched into a new chat.
- Preserve current last-N context limiting and conversation-start marker behavior.
- Add a visible chat settings control under Context Limit for summary-based auto trimming.
- Ensure manual summary edits update only the summary text, not the memory snapshot marker.

## Non-Goals

- Replacing the summary text format or changing summary prompts.
- Deleting, pruning, or otherwise modifying persisted chat messages.
- Reworking day/week conversation auto-summaries.
- Treating arbitrary metadata writes to `summary` as trusted memory snapshots.
- Changing model context fitting after the selected chat messages are assembled.
- Adding an option for the Chat Summary Generate button or built-in Chat Summary agent to summarize only messages since the last summary marker. This is an obvious follow-up because it would avoid repeatedly summarizing already-covered context, but it is outside the current auto-trim scope.

## Proposed Solution

### 1. Summary Snapshot Marker

Add a structured metadata field, tentatively named `chatSummarySnapshot`, to `ChatMetadata`:

```ts
type ChatSummarySnapshotSource =
  | "built_in_agent"
  | "manual_generate"
  | "append_chat_summary_tool";

interface ChatSummarySnapshot {
  source: ChatSummarySnapshotSource;
  updatedAt: string;
  anchorMessageId: string | null;
  anchorMessageCreatedAt: string | null;
  previousAnchors: Array<{
    messageId: string;
    messageCreatedAt: string | null;
    updatedAt: string;
  }>;
  coveredMessageCount: number;
  summaryLength: number;
}
```

The current anchor means: "the persisted `metadata.summary` was last intentionally updated after reviewing chat history through this anchor point." It is a marker for trimming prompt history, not a cryptographic guarantee that the summary contains every detail.

The anchor should normally be the latest message that existed in the chat at the time the summary update was committed. For generation-time built-in and custom-tool updates, prefer the just-saved assistant message if it exists; otherwise use the latest persisted message at the time of the metadata update. For the manual Generate button, use the newest message included in the summary request window.

The `previousAnchors` list stores recent earlier anchors so context trimming can fall back when the latest anchor message is deleted or otherwise invalid. Keep it bounded, for example the last 10 valid anchors, to avoid unbounded metadata growth.

### 2. Shared Summary Metadata Update Helper

Create a server-side helper for summary writes that updates `summary` and, when requested, stamps `chatSummarySnapshot` in the same metadata write. Use it from:

- `packages/server/src/routes/chats.routes.ts` in `/:id/generate-summary`;
- `packages/server/src/routes/generate.routes.ts` when persisting successful built-in `chat-summary` agent output;
- `packages/server/src/services/tools/tool-executor.ts` / route metadata callback path for `append_chat_summary`.

The helper should require an explicit trusted source. Generic `PATCH /chats/:id/metadata` remains a plain metadata merge and must not stamp the marker. That keeps manual edits in `SummaryPopover.handleSave` from moving the snapshot.

### 3. Context Trim Setting

Keep `contextMessageLimit` as the existing last-N ceiling. Add a separate metadata setting, tentatively:

```ts
trimAfterChatSummary?: boolean;
```

When `trimAfterChatSummary` is enabled, the generation route trims `chatMessages` after applying conversation-start filtering and regeneration exclusion, but before prompt assembly and agent context construction.

The two settings compose:

- `Trim After Chat Summary` is the floor: do not send messages at or before the last valid summary marker.
- `Limit Context Messages` is the ceiling: after applying the summary floor, still send no more than the configured last-N messages.

Example: if 80 messages exist after the last summary marker and `contextMessageLimit` is 50, only the latest 50 messages are sent. If 12 messages exist after the marker and the limit is 50, those 12 messages are sent.

Resolution algorithm:

1. Parse `chatSummarySnapshot`.
2. If the snapshot is missing, do not apply summary trimming.
3. Try the current `anchorMessageId` first. If it exists in the current chat message list, keep messages after that index.
4. If the current anchor is deleted or invalid, walk `previousAnchors` from newest to oldest and use the first `messageId` that exists in the current message list.
5. If no stored message ID resolves, optionally use the newest valid anchor timestamp only when it unambiguously leaves messages after the anchor; otherwise fail open by keeping the untrimmed list.
6. Apply `contextMessageLimit`, when enabled, after the summary floor.

This preserves message deletion safety while avoiding accidental full-context loss.

### 4. Fork and Delete Robustness

Branches should preserve both `summary` and `chatSummarySnapshot` when branching preserves chat history. Because branch creation creates new message IDs, the branch flow must remap `anchorMessageId` and all `previousAnchors.messageId` values through the existing source-to-branch message ID map.

If a branch is created before the latest anchor and that anchor is not copied, the branch should promote the newest copied `previousAnchors` entry to the current anchor. If no copied anchor remains, preserve the summary text but clear `chatSummarySnapshot` so the branch fails open until the next trusted summary update.

Message deletion does not need to eagerly rewrite the marker. Generation-time resolution should use `previousAnchors` when the current anchor is deleted or invalid. If deletion removes every valid anchor, the trim mode should fail open until the next summary update.

### 5. Chat Settings UI

Extend the Context Limit section in `ChatSettingsDrawer` with a second option:

- `Limit Context Messages`: existing last-N mode.
- `Trim After Chat Summary`: only send messages after the last trusted Chat Summary update.

The summary-trim option should show a disabled or informational state when no snapshot exists. It should display concise status such as the covered message count or "No Chat Summary update yet" if available from metadata.

If both options are enabled, label the behavior clearly: summary trim excludes already-summarized history from the model request first, and the message limit caps the number of remaining messages sent to the model.

## Risks and Mitigations

- Risk: the marker advances even though the summary update failed or produced empty text.
  Mitigation: stamp only after a non-empty summary patch is successfully persisted.
- Risk: manual summary edits accidentally mark old messages as summarized.
  Mitigation: only trusted helper calls can stamp `chatSummarySnapshot`; generic metadata patch cannot.
- Risk: deleted or forked anchors cause over-trimming.
  Mitigation: exact ID match first, previous valid anchors second, timestamp fallback only when unambiguous, and fail open when resolution is ambiguous.
- Risk: custom summary agents append tiny or low-value snippets and move the marker too often.
  Mitigation: the marker represents trusted tool usage; users control agent cadence from CR004 and can disable summary trim if the agent is not reliable.

## Validation

- `pnpm check` passes.
- Planned manual test: built-in Chat Summary agent updates `summary` and stamps `chatSummarySnapshot`.
- Planned manual test: Chat Summary popover Generate button stamps the marker.
- Planned manual test: manual summary edit changes `summary` but leaves `chatSummarySnapshot` unchanged.
- Planned manual test: custom agent using `append_chat_summary` appends summary text and stamps the marker.
- Planned manual test: enabling summary trim sends only messages after the snapshot marker.
- Planned manual test: deleting the current anchor message uses the previous valid anchor or fails open without emptying context.
- Planned manual test: branching a chat preserves summary and remaps the snapshot to copied message IDs, or safely clears only the snapshot when no copied anchor remains.
