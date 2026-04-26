# Title: Chat Summary Auto Trim

## Status

Draft

## Baseline

This CR branch starts from the local `upstream-main` branch and includes a merge of `change/CR004-custom-chat-summary-agent`.

While preparing the branch, `upstream-main` could not be fast-forwarded to `upstream/main` because the local branch has fork PR commits that are not present upstream, and `upstream/main` has one newer commit. The local `upstream-main` branch was left unchanged.

## Background

CR004 enabled custom chat memory agents through `read_chat_summary` and `append_chat_summary`, while preserving the built-in Chat Summary agent and the manual Generate button in the Chat Summary popover. That CR explicitly left summary-aware context trimming out of scope.

The current context limit setting can send only the last N messages to the model, but it is not connected to memory freshness. Once a chat summary has captured older conversation history, users should be able to stop sending the summarized messages while still sending new messages after the last trusted Chat Summary update.

## Problem Statement

Chat Summary updates currently persist summary text but do not record which chat message history was covered by that update. Without a durable marker, the generation pipeline cannot safely trim prompt messages to "messages after the last memory update", and users cannot confidently delete summarized messages.

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
- Assess and provide a user action to trim persisted messages before the last Chat Summary update.
- Ensure manual summary edits update only the summary text, not the memory snapshot marker.

## Non-Goals

- Replacing the summary text format or changing summary prompts.
- Automatically deleting persisted messages without explicit user action.
- Reworking day/week conversation auto-summaries.
- Treating arbitrary metadata writes to `summary` as trusted memory snapshots.
- Changing model context fitting after the selected chat messages are assembled.

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
  coveredMessageCount: number;
  summaryLength: number;
}
```

The marker means: "the persisted `metadata.summary` was last intentionally updated after reviewing chat history through this anchor point." It is a marker for trimming prompt history, not a cryptographic guarantee that the summary contains every detail.

The anchor should normally be the latest message that existed in the chat at the time the summary update was committed. For generation-time built-in and custom-tool updates, prefer the just-saved assistant message if it exists; otherwise use the latest persisted message at the time of the metadata update. For the manual Generate button, use the newest message included in the summary request window.

### 2. Shared Summary Metadata Update Helper

Create a server-side helper for summary writes that updates `summary` and, when requested, stamps `chatSummarySnapshot` in the same metadata write. Use it from:

- `packages/server/src/routes/chats.routes.ts` in `/:id/generate-summary`;
- `packages/server/src/routes/generate.routes.ts` when persisting successful built-in `chat-summary` agent output;
- `packages/server/src/services/tools/tool-executor.ts` / route metadata callback path for `append_chat_summary`.

The helper should require an explicit trusted source. Generic `PATCH /chats/:id/metadata` remains a plain metadata merge and must not stamp the marker. That keeps manual edits in `SummaryPopover.handleSave` from moving the snapshot.

### 3. Context Trim Modes

Keep `contextMessageLimit` as the existing last-N setting. Add a separate metadata setting, tentatively:

```ts
contextTrimMode?: "last_n" | "after_chat_summary";
```

When `contextTrimMode` is `after_chat_summary`, the generation route trims `chatMessages` after applying conversation-start filtering and regeneration exclusion, but before prompt assembly and agent context construction.

Resolution algorithm:

1. Parse `chatSummarySnapshot`.
2. If the snapshot is missing or `anchorMessageId`/`anchorMessageCreatedAt` cannot resolve safely, do not apply summary trimming.
3. Prefer an exact `anchorMessageId` match in the current `chatMessages`; keep messages after that index.
4. If the anchor message was deleted, fall back to `anchorMessageCreatedAt` and keep messages with `createdAt` greater than the anchor timestamp.
5. If fallback would produce an empty context while the chat contains messages after the current user message save, fail open by keeping the untrimmed list.
6. If `contextMessageLimit` is also set, apply the stricter of the two windows by keeping the shorter suffix after both filters.

This preserves message deletion safety while avoiding accidental full-context loss.

### 4. Fork and Delete Robustness

Branches currently clear `summary`, `daySummaries`, and `weekSummaries` when copying metadata. CR005 should either continue clearing `summary` and also clear `chatSummarySnapshot`, or preserve both only when the branch copies the anchor message and can remap `anchorMessageId` to the new branch's message ID.

Recommended MVP: clear `chatSummarySnapshot` whenever branching clears `summary`. If a later branch design preserves summary text, it must validate/remap the snapshot in the same branch transaction.

Message deletion does not need to eagerly rewrite the marker. Generation-time resolution can handle deleted anchors through timestamp fallback. If bulk deletion removes all messages after the snapshot, the trim mode should fail open until the next summary update.

### 5. Chat Settings UI

Extend the Context Limit section in `ChatSettingsDrawer` with a second option:

- `Limit Context Messages`: existing last-N mode.
- `Trim After Chat Summary`: only send messages after the last trusted Chat Summary update.

The summary-trim option should show a disabled or informational state when no snapshot exists. It should display concise status such as the covered message count or "No Chat Summary update yet" if available from metadata.

If both options are enabled, label the behavior clearly as "Use the smaller context window." The implementation can model this as independent settings rather than a mutually exclusive selector so existing chats keep their behavior.

### 6. Manual Trim Action

Add an explicit user action near the new Context Limit option:

`Trim Messages Before Summary`

This should:

- require a confirmation dialog that states how many messages will be deleted;
- compute the target set server-side from the current snapshot, not from stale client state;
- delete only messages strictly before or at the snapshot anchor, leaving all messages after the marker;
- refuse to run if the snapshot cannot be resolved safely;
- invalidate message and message-count queries after success.

The action should be a separate route, for example `POST /api/chats/:id/trim-before-summary`, so deletion rules and snapshot resolution live with storage rather than in the client.

## Risks and Mitigations

- Risk: the marker advances even though the summary update failed or produced empty text.
  Mitigation: stamp only after a non-empty summary patch is successfully persisted.
- Risk: manual summary edits accidentally mark old messages as summarized.
  Mitigation: only trusted helper calls can stamp `chatSummarySnapshot`; generic metadata patch cannot.
- Risk: deleted or forked anchors cause over-trimming.
  Mitigation: exact ID match first, timestamp fallback second, fail open when resolution is ambiguous.
- Risk: users delete useful history too easily.
  Mitigation: make persisted deletion an explicit confirmed action separate from prompt-context trimming.
- Risk: custom summary agents append tiny or low-value snippets and move the marker too often.
  Mitigation: the marker represents trusted tool usage; users control agent cadence from CR004 and can disable summary trim if the agent is not reliable.

## Validation

- `pnpm check` passes.
- Manual test: built-in Chat Summary agent updates `summary` and stamps `chatSummarySnapshot`.
- Manual test: Chat Summary popover Generate button stamps the marker.
- Manual test: manual summary edit changes `summary` but leaves `chatSummarySnapshot` unchanged.
- Manual test: custom agent using `append_chat_summary` appends summary text and stamps the marker.
- Manual test: enabling summary trim sends only messages after the snapshot marker.
- Manual test: deleting the anchor message uses timestamp fallback or fails open without emptying context.
- Manual test: branching a chat does not preserve an invalid snapshot.
- Manual test: the manual trim action deletes only messages at or before the resolved snapshot anchor and refreshes the UI counts.
