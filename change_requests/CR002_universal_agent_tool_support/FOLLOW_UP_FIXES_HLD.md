# Title: Universal Agent Tool Support Follow-up Fixes
## Status: Draft
## Goals:
- Eliminate duplicated Spotify credential resolution within the generate route.
- Remove redundant Spotify-specific tool-context reassignment after universal tool-context setup.
- Prevent agent tool-call logging from leaking secrets or sensitive user data in normal operation.

## Problem Statement
The initial universal agent tool support work correctly moved tool enablement beyond the Spotify agent, but the current route still contains follow-up issues that should be addressed before the design is considered complete.

First, Spotify credentials are still resolved twice within `packages/server/src/routes/generate.routes.ts`: once before universal tool-context attachment and again later in the main-generation path. That creates avoidable duplication and leaves room for inconsistent in-memory state if one refresh path updates credentials and the other continues using stale values.

Second, even after universal `toolContext` attachment is performed for all agents, the route still reassigns a Spotify-specific `toolContext` later in the request. That makes the flow harder to reason about and can overwrite the context already attached in the generic path.

Third, agent tool execution logging in `packages/server/src/services/agents/agent-executor.ts` currently logs raw tool arguments and raw tool results unconditionally. For custom tools, those payloads may contain API keys, tokens, prompts, user content, or other sensitive values that should not be emitted in normal server logs.

## Proposed Solution
- **Centralize Spotify credential resolution in `generate.routes.ts`:**
  - Resolve and refresh Spotify credentials once per request.
  - Store the resolved credentials in a single request-scoped object.
  - Reuse that object for both universal agent tool execution and the main-generation tool loop.
- **Remove the late Spotify-only `toolContext` reassignment:**
  - Treat Spotify like any other tool-enabled agent.
  - Keep special-case Spotify credential preparation if needed, but stop rebuilding the tool context later.
- **Harden agent tool-call logging in `agent-executor.ts`:**
  - Gate verbose tool-call logs behind `isDebugAgentsEnabled()` or a dedicated tool-debug flag.
  - Redact sensitive-looking argument/result fields before logging.
  - Keep minimal non-sensitive operational logging if needed, such as tool name and success/failure.

## Scope
- `packages/server/src/routes/generate.routes.ts`
- `packages/server/src/services/agents/agent-executor.ts`

## Non-Goals
- Adding new built-in tools.
- Changing the user-facing tool configuration UI.
- Redesigning the broader agent pipeline or batching model.
- Revisiting comments from PR #188 that are now obsolete because the relevant files or earlier chat-summary code are no longer part of this branch.

## Risks and Considerations
- Refactoring the Spotify flow must preserve the current refresh behavior and not break the main-generation path.
- If redaction is too aggressive, debugging custom tool failures may become harder; the design should retain an explicit debug path.

## Success Criteria
- Spotify credentials are resolved once per request and reused consistently.
- The universal tool-context assignment is the only tool-context setup for Spotify agents.
- Raw tool arguments/results are not emitted in normal logs.
