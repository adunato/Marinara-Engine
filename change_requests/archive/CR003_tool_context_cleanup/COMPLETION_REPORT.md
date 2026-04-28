# Title: Generalized Tool Metadata I/O & Context Repair (CR003)
## Status: Completed
## Completion Date: 2026-04-22

## Summary
Successfully implemented a generalized I/O bridge for tools to interact with chat metadata. This architecture decouples tools from the database infrastructure and provides automatic frontend synchronization.

## Key Changes
- **Generalized Context Bridge:**
    - Tools now read from `chatMeta` (in-memory) and write via `onUpdateMetadata(patch)`.
    - Removed `db` and `chatId` handles from the tool execution context.
- **Centralized Persistence & Signaling:**
    - The `generate` route implements `onUpdateMetadata`, which persists changes to the DB and emits a generalized `metadata_patch` SSE event.
- **Automatic Frontend Refresh:**
    - The `use-generate.ts` hook now listens for `metadata_patch` and invalidates the chat metadata query, ensuring the UI (e.g., summary popover) updates instantly.
- **Universal Agent Support:**
    - The universal agent pipeline now provides this full context bridge, allowing sidecar agents to use summarization tools effectively.
- **Code Consolidation:**
    - Unified Spotify logic and tool assignment into a single preparation phase.

## Verification
- Both server and client builds passed.
- Logic audit confirms all tools now use the generalized bridge.
- The UI will now automatically stay in sync with AI-driven background changes.
