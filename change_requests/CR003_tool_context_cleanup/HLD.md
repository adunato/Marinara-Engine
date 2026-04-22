# Title: Generalized Tool Metadata I/O & Context Repair (CR003)
## Status: Draft

## Prerequisites
- **CR001 (Chat Summary Tools):** Introduced `read_chat_summary` and `append_chat_summary` tools. These allow agents to manage long-term context but currently require manual database access and specific context fields.
- **CR002 (Universal Agent Tool Support):** Enabled tool usage for all agents but failed to provide the necessary context (DB handles, IDs) for metadata-aware tools to function within the agent pipeline.

## Problem Statement

### 1. Context Gap & Infrastructure Leakage
Tools that need to interact with the chat's state (like `append_chat_summary`) currently have to "reach out" to the infrastructure by requesting `db` and `chatId` handles. This leads to:
*   **Code Duplication:** Every tool that updates metadata must repeat the logic of fetching the chat, parsing metadata, merging changes, and saving to the DB.
*   **Execution Failures:** The universal agent pipeline (CR002) does not currently provide these handles, meaning tools fail when called by agents.
*   **Brittle Interfaces:** We are currently passing specific fields (like `chatSummary`). Adding any new piece of state (e.g., `chatInventory`) requires changing the `ToolExecutor` and the routing layer.

### 2. Lack of Automatic Frontend Sync
When a tool updates the database (e.g., appending to a summary), the frontend has no way of knowing the data has changed until the next full page refresh or a manual action. We need a way to signal these background changes to the UI without hardcoding "refresh" logic into every individual tool.

### 3. Redundant Routing Logic
The server currently maintains separate, duplicated blocks for Spotify token management and tool assignment. This should be consolidated into a single, universal preparation phase.

## Goals
- **Fix the Context Gap:** Ensure all agents have the ability to interact with the chat's state through a unified interface.
- **Decouple Tools from DB:** Transition to a "Postman" model where tools read from a provided `chatMeta` object and write via a provided `onUpdateMetadata` callback.
- **Unified Signaling:** Implement a generalized SSE event (`metadata_patch`) that the server emits whenever a tool updates chat metadata, allowing the frontend to refresh automatically.
- **Cleanup:** Consolidate Spotify logic and unify the `ToolExecutor` context.

## Proposed Solution

### 1. The "Generalized I/O" Context
Update the `ToolExecutor` context in `packages/server/src/services/tools/tool-executor.ts` to use a "Read/Write" bridge:
```typescript
context?: {
  // Read Bridge: The already-parsed metadata for high-performance reads
  chatMeta?: Record<string, unknown>; 
  
  // Write Bridge: A callback function provided by the route to handle persistence
  onUpdateMetadata?: (patch: Record<string, unknown>) => Promise<void>;
  
  // ... other infrastructure (spotify, customTools, searchLorebook)
}
```

### 2. Tool Implementation (Decoupled)
Tools will no longer require `db` or `chatId`.
*   **`read_chat_summary`**: Simply returns `context.chatMeta.summary`.
*   **`append_chat_summary`**: Computes the new summary and calls `context.onUpdateMetadata({ summary: newText })`. It doesn't know *how* the data is saved; it just provides the patch.

### 3. Route Orchestration (Centralized Responsibility)
In `packages/server/src/routes/generate.routes.ts`:
1.  **Define the Bridge:** Create a `baseToolContext` that implements `onUpdateMetadata`.
2.  **Implementation of `onUpdateMetadata`:** 
    - Merges the patch into the local `chatMeta` reference.
    - Persists the change to the database using the route's existing `db` and `chatId`.
    - Emits a `metadata_patch` SSE event to the client stream.
3.  **Inject and Execute:** Pass this context to both the main assistant and all agents.

### 4. Frontend Signaling
Update `packages/client/src/hooks/use-generate.ts` to listen for the `metadata_patch` event. When received, it will invalidate the chat detail query, forcing the UI (like the summary popover) to refresh instantly.

## Impact Analysis
- **Maintainability:** Adding a new tool that interacts with chat state (e.g., `update_journal`) requires zero changes to the routing or infrastructure logic.
- **Performance:** Tools benefit from in-memory reads while writes remain transactional and consistent.
- **User Experience:** The UI stays in sync with AI-driven background changes automatically.
