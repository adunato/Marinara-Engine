# Implementation Plan: Tool Execution Context Cleanup & Repair (CR003)

## Prerequisites
- Merged CR001 (Chat Summary Tools)
- Merged CR002 (Universal Agent Tool Support)

## Step-by-Step Tasks

### 1. Update Tool Context Interface
**File:** `packages/server/src/services/tools/tool-executor.ts`
- Modify `executeToolCalls` and `executeSingleTool` context interface:
  - Remove `chatSummary?: string | null`.
  - Add `chatMeta?: Record<string, unknown>`.
- Update `readChatSummary`:
  - Access summary from `context.chatMeta?.summary`.
- Update `appendChatSummary`:
  - No change needed to data fetching logic (it already uses `db` and `chatId`), but verify context extraction.

### 2. Refactor Routing Preparation
**File:** `packages/server/src/routes/generate.routes.ts`
- Consolidate all Spotify token-refresh logic into the "Early Refresh" block (currently around line 3500-3560).
- Move `customToolDefs` resolution into the same preparation phase.
- Create a `baseToolContext` object early in the route.

### 3. Apply Unified Context to Agent Loop
**File:** `packages/server/src/routes/generate.routes.ts`
- Update the `resolvedAgents` loop (currently around line 3570) to use the `baseToolContext` in the `agent.toolContext.executeToolCall` wrapper.
- Ensure the context contains `db`, `chatId`, `chatMeta`, `customTools`, `spotify`, and `searchLorebook`.

### 4. Cleanup Redundant Blocks
**File:** `packages/server/src/routes/generate.routes.ts`
- Delete the redundant `if (spotifyAgent)` block near line 4300 that repeats refresh and manual tool assignment.

### 5. Audit Main Generation Loop
**File:** `packages/server/src/routes/generate.routes.ts`
- Update the main assistant's `executeToolCalls` invocation (around line 4500) to use the `baseToolContext`.

## Files Affected
- `packages/server/src/services/tools/tool-executor.ts`
- `packages/server/src/routes/generate.routes.ts`

## Verification
- **Manual Test:** Create an agent with `read_chat_summary` and verify it returns the summary from `chatMeta`.
- **Manual Test:** Create an agent with `append_chat_summary` and verify it persists the update via DB.
- **Manual Test:** Verify Spotify agent still refreshes tokens and fetches playlists correctly.
- **Manual Test:** Verify Custom tools still function.

## Rollback
- Revert changes to the two affected files.
