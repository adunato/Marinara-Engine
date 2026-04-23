# Implementation Plan: Universal Agent Tool Support Follow-up Fixes
## Prerequisites:
- Confirm that this work is a follow-up to `CR002_universal_agent_tool_support`, not a separate change request.
- Preserve current runtime behavior except where required to remove duplication or logging risk.

## Step-by-Step Tasks:
1. Refactor Spotify credential handling in `packages/server/src/routes/generate.routes.ts`:
   - Identify both Spotify credential resolution blocks.
   - Extract or consolidate them into a single request-scoped resolution path.
   - Ensure refreshed credentials are reused by all later tool execution call sites in the same request.
2. Remove redundant Spotify-only tool-context reassignment in `packages/server/src/routes/generate.routes.ts`:
   - Verify the universal agent tool-context setup already covers Spotify.
   - Delete the later Spotify-specific reassignment block.
   - Confirm the main-generation path still receives the same resolved Spotify credentials without needing agent-level reassignment.
3. Harden logging in `packages/server/src/services/agents/agent-executor.ts`:
   - Wrap verbose tool-call argument/result logging behind `isDebugAgentsEnabled()` or an equivalent dedicated debug guard.
   - Introduce lightweight redaction for sensitive fields if payload logging remains available in debug mode.
   - Retain high-signal non-sensitive logs such as tool name, round, and success/failure where useful.
4. Validate the resulting flow:
   - Confirm there is only one Spotify credential resolution path.
   - Confirm Spotify agents rely on the universal tool-context setup only.
   - Confirm default logs no longer print raw tool arguments/results.

## Files Affected
- `packages/server/src/routes/generate.routes.ts`
- `packages/server/src/services/agents/agent-executor.ts`

## Verification
- Run `pnpm check`.
- Manual verification:
  - Use a Spotify-enabled agent and confirm tool execution still works after the refactor.
  - Use a custom tool with obviously sensitive-looking arguments and confirm normal logs do not print raw payloads.
  - Confirm universal tool execution still works for non-Spotify agents.
- Optional targeted validation:
  - Search the route for duplicated Spotify refresh logic and confirm only one active path remains.
  - Search `agent-executor.ts` for raw `[agent-tools]` payload logging outside the chosen debug guard.

## Rollback
- Revert changes to:
  - `packages/server/src/routes/generate.routes.ts`
  - `packages/server/src/services/agents/agent-executor.ts`
- Re-run `pnpm check` to confirm the rollback is clean.
