# Implementation Plan: Chat Summary Auto Trim

## Prerequisites

- Work on `change/CR005-chat-summary-auto-trim`.
- Keep the CR004 merge in the branch because `append_chat_summary` is in scope.
- Read `packages/client/.instructions.md` before editing client code.
- Use `pnpm check` as baseline validation.

## Atomic Tasks

### 1. Define Metadata Types

Files likely affected:

- `packages/shared/src/types/chat.ts`

Tasks:

- Add `ChatSummarySnapshotSource`.
- Add `ChatSummarySnapshot`.
- Include a bounded `previousAnchors` list in the snapshot shape.
- Add optional `chatSummarySnapshot` and `trimAfterChatSummary` fields to `ChatMetadata`.
- Keep `[key: string]: unknown` compatibility for existing metadata.

### 2. Add Server Snapshot Helpers

Files likely affected:

- `packages/server/src/routes/generate/generate-route-utils.ts` or a new helper under `packages/server/src/routes/generate/`
- `packages/server/src/services/storage/chats.storage.ts`

Tasks:

- Implement a helper to resolve the latest summary anchor from a message list.
- Implement a helper to append or replace summary text and optionally stamp `chatSummarySnapshot`.
- When stamping a new snapshot, push the previous current anchor into bounded `previousAnchors`.
- Ensure helper returns updated metadata for SSE/client refresh paths.
- Keep manual metadata updates outside this helper unless they pass an explicit trusted source.

### 3. Stamp Manual Generate Updates

Files likely affected:

- `packages/server/src/routes/chats.routes.ts`
- `packages/client/src/hooks/use-chats.ts` only if response shape changes

Tasks:

- In `POST /chats/:id/generate-summary`, anchor the snapshot to the latest message included in `recentMessages`.
- Persist `summary` plus `chatSummarySnapshot` together.
- Return the combined summary as today.

### 4. Stamp Built-In Agent Updates

Files likely affected:

- `packages/server/src/routes/generate.routes.ts`

Tasks:

- When a successful `chat_summary` agent result appends non-empty text, stamp `chatSummarySnapshot` with source `built_in_agent`.
- Prefer the saved assistant `messageId` if available, otherwise use the newest current chat message.
- Preserve the existing `chat_summary` and `metadata_patch` stream behavior so the client refreshes.

### 5. Stamp `append_chat_summary` Tool Updates

Files likely affected:

- `packages/server/src/services/tools/tool-executor.ts`
- `packages/server/src/routes/generate.routes.ts`
- `packages/server/src/routes/generate/retry-agents-route.ts` if retry agents can execute summary tools

Tasks:

- Extend metadata update context with optional trusted summary source metadata or expose a dedicated summary append callback.
- Ensure `append_chat_summary` stamps source `append_chat_summary_tool` only when the append succeeds.
- Keep non-summary metadata patches unchanged.

### 6. Apply Summary-Based Context Trimming

Files likely affected:

- `packages/server/src/routes/generate.routes.ts`
- `packages/server/src/routes/chats.routes.ts` prompt preview path, if preview should reflect runtime trimming

Tasks:

- Add a resolver that takes `chatMessages` and `chatSummarySnapshot`.
- Exact-match `anchorMessageId` first.
- Fall back to the newest resolvable `previousAnchors` entry when the current anchor ID was deleted or is invalid.
- Use timestamp fallback only when it is unambiguous.
- Fail open when the marker is missing, stale, points outside the copied branch, or would produce unsafe empty context.
- Apply summary trimming as the context floor, then apply `contextMessageLimit` as the last-N ceiling.
- Keep conversation-start filtering and regeneration exclusion behavior intact.

### 7. Branch and Delete Handling

Files likely affected:

- `packages/server/src/routes/chats.routes.ts`
- `packages/server/src/services/storage/chats.storage.ts`

Tasks:

- Preserve `summary` when branching.
- Remap `chatSummarySnapshot.anchorMessageId` and `previousAnchors.messageId` through the source-to-branch message ID map.
- If the current anchor was not copied, promote the newest copied previous anchor to the current anchor.
- If no anchor was copied, preserve `summary` but clear `chatSummarySnapshot`.
- Do not eagerly clear snapshots during message deletion; rely on generation-time resolution through previous valid anchors.
- Add tests or manual verification for deleted anchor fallback.

### 8. Add Chat Settings Controls

Files likely affected:

- `packages/client/src/components/chat/ChatSettingsDrawer.tsx`

Tasks:

- Add a Context Limit option for summary-based trimming.
- Display marker status from `metadata.chatSummarySnapshot`.
- Keep `Limit Context Messages` available as the ceiling and `Trim After Chat Summary` available as the floor.
- Avoid adding any message deletion, pruning, or manual persisted trim action.
- Keep layout consistent with the existing Context Limit panel.

### 9. Track Follow-Up Summary Generation Scope

Files likely affected:

- `change_requests/CR005_chat_summary_auto_trim/HLD.md`

Tasks:

- Keep "summarize only messages since the last summary marker" as a documented non-goal/follow-up for both the Chat Summary Generate button and built-in Chat Summary agent.
- Do not implement this behavior in CR005 unless the CR scope is explicitly expanded.

### 10. Verification

- [ ] Run `pnpm check`.
- [ ] Built-in Chat Summary agent stamps marker.
- [ ] Generate button stamps marker.
- [ ] Manual summary save does NOT stamp/change marker.
- [ ] Custom `append_chat_summary` stamps marker.
- [ ] Summary trim affects generation context.
- [ ] Last-N limit remains a ceiling with summary trim.
- [ ] Deleting current anchor falls back or fails open.
- [ ] Branching preserves/remaps/promotes/clears snapshot safely.
- [ ] No CR005 path deletes persisted messages.

## Rollback

- Revert CR005 implementation commits.
- Remove `chatSummarySnapshot` and `trimAfterChatSummary` handling.
- Confirm existing `contextMessageLimit`, Chat Summary Generate, built-in Chat Summary agent, and CR004 summary tools still work.
- Run `pnpm check`.
