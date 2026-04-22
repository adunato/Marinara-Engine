# Title: Tool Execution Context Cleanup & Repair (CR003)
## Status: Draft

## Prerequisites
- **CR001 (Chat Summary Tools):** Introduced `read_chat_summary` and `append_chat_summary` tools. These allow agents to manage long-term context but require access to the database and chat-specific metadata.
- **CR002 (Universal Agent Tool Support):** Modified the server to allow all agents (not just Spotify) to use tools. However, the implementation of the universal pipeline introduced in CR002 failed to provide critical context fields like `db` and `chatId` to the tool executor.

## Problem Statement
The current implementation of the tool pipeline in `packages/server/src/routes/generate.routes.ts` has three primary issues:

1. **Context Disparity:**
   - The **Main Assistant Loop** and the **Legacy Spotify Agent** block both pass `db`, `chatId`, and `chatSummary` to the `executeToolCalls` function.
   - The **Universal Agent Pipeline** (added in CR002) is missing these fields entirely, passing only `customTools`, `spotify`, and `searchLorebook`.
   - **Consequence:** Tools like `append_chat_summary` (which needs `db` to persist data) and `read_chat_summary` fail when called by any agent via the universal pipeline.

2. **Redundant Spotify Logic:**
   - The route manages Spotify token refreshing and tool context assignment in two separate, near-identical blocks.
   - **Snippet A (Early Preparation):** Lines 3500-3560 handle token refresh for all potential agents.
   - **Snippet B (Late Assignment):** Lines 4300-4350 repeat the refresh logic and manually assign tools specifically for a "spotify" agent.
   - This duplication is brittle and bypasses the universal tool architecture.

3. **Brittle Context Interface:**
   - We currently pass specific data fields like `chatSummary`. If a future tool needs the `gameJournal` or `influenceMap`, we must modify the `ToolExecutor` interface and the routing layer again.
   - While `chatId` and `db` are sufficient to fetch any data from the database, the route already has the chat metadata parsed in memory. Re-fetching it in every tool call is inefficient.

## Goals
- **Fix the Context Gap:** Ensure the Universal Agent Pipeline receives the same complete context as the main assistant.
- **Consolidate Logic:** Remove the redundant Spotify-specific blocks and rely on the universal pipeline for all agents.
- **Generalize Context Access:** Move from passing specific fields (like `chatSummary`) to passing the full, already-parsed `chatMeta` object.

## Proposed Solution

### 1. Unified and General Context
We will update the `executeToolCalls` context in `packages/server/src/services/tools/tool-executor.ts` to be more general:
```typescript
context?: {
  db?: DB;
  chatId?: string;
  chatMeta?: Record<string, unknown>; // Parsed metadata payload from the route
  customTools?: CustomToolDef[];
  searchLorebook?: LorebookSearchFn;
  spotify?: SpotifyCredentials;
}
```
Tools like `read_chat_summary` will prefer `context.chatMeta.summary` (in-memory access), while `append_chat_summary` will use `db` and `chatId` for transactional persistence.

### 2. Route Refactoring
In `packages/server/src/routes/generate.routes.ts`:
1. **Consolidate Preparation:** Move Spotify refresh and Custom Tool loading to a single "Context Preparation" phase at the top of the route.
2. **Shared Context Object:** Define a `baseToolContext` that includes all the fields mentioned above.
3. **Single Injection Point:** Use this `baseToolContext` when initializing the `toolContext` for every agent in the `resolvedAgents` loop.
4. **Remove Redundancy:** Delete the hardcoded Spotify block at line 4300.

## Impact Analysis
- **Agents:** All agents gain the ability to use DB-backed and metadata-aware tools.
- **Performance:** Passing `chatMeta` avoids redundant database reads and parsing within the tool execution loop.
- **Maintainability:** New tools interacting with chat metadata can be added to the `ToolExecutor` without changing the routing logic.
