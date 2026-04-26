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
- Add optional `chatSummarySnapshot` and `contextTrimMode` fields to `ChatMetadata`.
- Keep `[key: string]: unknown` compatibility for existing metadata.

### 2. Add Server Snapshot Helpers

Files likely affected:

- `packages/server/src/routes/generate/generate-route-utils.ts` or a new helper under `packages/server/src/routes/generate/`
- `packages/server/src/services/storage/chats.storage.ts`

Tasks:

- Implement a helper to resolve the latest summary anchor from a message list.
- Implement a helper to append or replace summary text and optionally stamp `chatSummarySnapshot`.
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
- Fall back to `anchorMessageCreatedAt` when the ID was deleted.
- Fail open when the marker is missing, stale, points outside the copied branch, or would produce unsafe empty context.
- Compose with `contextMessageLimit` so the final prompt uses the shorter suffix.
- Keep conversation-start filtering and regeneration exclusion behavior intact.

### 7. Branch and Delete Handling

Files likely affected:

- `packages/server/src/routes/chats.routes.ts`
- `packages/server/src/services/storage/chats.storage.ts`

Tasks:

- Clear `chatSummarySnapshot` when branch creation clears `summary`.
- Do not eagerly clear snapshots during message deletion for MVP; rely on generation-time resolution.
- Add tests or manual verification for deleted anchor fallback.

### 8. Add Manual Trim Route

Files likely affected:

- `packages/server/src/routes/chats.routes.ts`
- `packages/server/src/services/storage/chats.storage.ts`
- `packages/shared/src/schemas/chat.schema.ts` if a request/response schema is added

Tasks:

- Add `POST /chats/:id/trim-before-summary`.
- Resolve the snapshot against current persisted messages server-side.
- Delete messages at or before the anchor only when the anchor resolves safely.
- Return deleted count and remaining count.
- Refuse ambiguous markers with a 400 response.

### 9. Add Chat Settings Controls

Files likely affected:

- `packages/client/src/components/chat/ChatSettingsDrawer.tsx`
- `packages/client/src/hooks/use-chats.ts`

Tasks:

- Add a Context Limit option for summary-based trimming.
- Display marker status from `metadata.chatSummarySnapshot`.
- Add a confirmed `Trim Messages Before Summary` action.
- Invalidate `chatKeys.messages(chat.id)`, `chatKeys.messageCount(chat.id)`, and `chatKeys.detail(chat.id)` after manual trim.
- Keep layout consistent with the existing Context Limit panel.

### 10. Verification

- Run `pnpm check`.
- Verify built-in Chat Summary agent stamps the marker.
- Verify Generate button stamps the marker.
- Verify manual summary save does not stamp or change the marker.
- Verify custom `append_chat_summary` stamps the marker.
- Verify summary trim affects generation prompt context.
- Verify last-N limit still works alone and with summary trim.
- Verify deleting the anchor does not break generation.
- Verify branching clears or safely remaps the snapshot.
- Verify manual trim deletes the expected messages and refreshes UI message numbering.

## Rollback

- Revert CR005 implementation commits.
- Remove `chatSummarySnapshot` and `contextTrimMode` handling.
- Remove the manual trim route and UI action.
- Confirm existing `contextMessageLimit`, Chat Summary Generate, built-in Chat Summary agent, and CR004 summary tools still work.
- Run `pnpm check`.
