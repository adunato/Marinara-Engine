# Implementation Plan: Generalized Tool Metadata I/O & Context Repair (CR003)

## Prerequisites
- Merged CR001 (Chat Summary Tools)
- Merged CR002 (Universal Agent Tool Support)

## Step-by-Step Tasks

### 1. Update Tool Context & Interfaces
**File:** `packages/server/src/services/tools/tool-executor.ts`
- Modify the context interface for `executeToolCalls` and `executeSingleTool`:
  - **Remove** `db?: DB`, `chatId?: string`, and `chatSummary?: string | null`.
  - **Add** `chatMeta?: Record<string, unknown>` (Generalized Read).
  - **Add** `onUpdateMetadata?: (patch: Record<string, unknown>) => Promise<void>` (Generalized Write).
- **Update Implementations:**
  - `readChatSummary`: Extract `summary` from `context.chatMeta?.summary`.
  - `appendChatSummary`: Compute new summary, then call `context.onUpdateMetadata({ summary: combined })`.

### 2. Consolidate Route Preparation & Bridge Implementation
**File:** `packages/server/src/routes/generate.routes.ts`
- Consolidate Spotify token-refresh and `customToolDefs` resolution into a single phase early in the route.
- Define `onUpdateMetadata` implementation:
  - Takes a `patch` (e.g., `{ summary: '...' }`).
  - Fetches the latest chat from the database.
  - Merges the patch into the chat's metadata.
  - Saves the result back to the database.
  - Merges the patch into the local `chatMeta` reference.
  - Emits an SSE event: `data: { type: "metadata_patch", data: patch }`.
- Define `baseToolContext` object including `chatMeta` and the new `onUpdateMetadata` callback.

### 3. Repair Universal Agent Pipeline
**File:** `packages/server/src/routes/generate.routes.ts`
- Update the `resolvedAgents` loop to pass the full `baseToolContext` into the `agent.toolContext.executeToolCall` wrapper. This enables all agents to read and write metadata.

### 4. Cleanup Redundant Blocks
**File:** `packages/server/src/routes/generate.routes.ts`
- Delete the redundant Spotify-specific block (near line 4300) that manually manages tokens and tools.
- Update the main assistant's tool execution call (near line 4500) to use the unified `baseToolContext`.

### 5. Frontend Signaling Handler
**File:** `packages/client/src/hooks/use-generate.ts`
- In both the generation and retry SSE listener loops, add a `case "metadata_patch"`.
- Action: `qc.invalidateQueries({ queryKey: chatKeys.detail(params.chatId) })`.

## Files Affected
- `packages/server/src/services/tools/tool-executor.ts`
- `packages/server/src/routes/generate.routes.ts`
- `packages/client/src/hooks/use-generate.ts`

## Verification
- **Build Pass:** Verify server and client compile without errors.
- **Manual Test (Summarizer Agent):** Verify an agent can append a summary and the summary popover updates instantly in the UI.
- **Manual Test (Spotify):** Verify Spotify tools still function correctly using the consolidated logic.
- **Manual Test (Custom Tools):** Verify custom tools still function.

## Rollback
- Revert changes to the three affected files using `git checkout`.
