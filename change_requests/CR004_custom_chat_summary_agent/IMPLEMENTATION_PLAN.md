# Implementation Plan: Custom Chat Summary Agent

## Prerequisites

- Start from refreshed `upstream-main`, after fetching and integrating the latest `Pasta-Devs/main`.
- Review CR001 and CR003 only as historical context; this CR is the implementation source of truth.
- Read `packages/client/.instructions.md` before editing client code.

## Step-by-Step Tasks

### 1. Finalize Summary Agent Design

- Decide whether the summary agent is implemented as a built-in agent type, seeded default agent, or configurable template.
- Define when the summary agent runs in the generation lifecycle.
- Define the summary update contract: append, replace, structured patch, or a constrained combination.
- Document expected enablement and failure behavior in the HLD before implementation.

### 2. Define Summary Tool Contracts

Files likely affected:

- `packages/shared/src/types/agent.ts`
- `packages/shared/src/schemas/agent.schema.ts`
- `packages/server/src/services/tools/tool-executor.ts`

Tasks:

- Define `read_chat_summary`.
- Define the summary update tool or operation selected during design finalization.
- Ensure tool definitions include clear parameter schemas and descriptions.
- Ensure summary tools are discoverable only where appropriate.

### 3. Implement Generalized Metadata I/O

Files likely affected:

- `packages/server/src/services/tools/tool-executor.ts`
- `packages/server/src/routes/generate.routes.ts`
- `packages/server/src/routes/generate/retry-agents-route.ts`
- `packages/server/src/services/agents/agent-executor.ts`
- `packages/server/src/services/agents/agent-pipeline.ts`

Tasks:

- Add `chatMeta` read access to tool execution context.
- Add `onUpdateMetadata` write callback to tool execution context.
- Remove summary tools' direct dependency on route-level database handles.
- Pass the shared context to the main assistant and all eligible agents.
- Keep existing Spotify and custom-tool behavior working while reducing duplicate preparation logic where practical.

### 4. Persist and Signal Metadata Patches

Files likely affected:

- `packages/server/src/routes/generate.routes.ts`
- `packages/server/src/services/storage/chats.storage.ts`

Tasks:

- Implement route-owned metadata patch persistence.
- Merge patches into the request-local metadata object.
- Emit a metadata patch SSE event when metadata changes.
- Ensure errors are logged and surfaced without crashing unrelated generation work.

### 5. Update Client Summary Refresh

Files likely affected:

- `packages/client/src/hooks/use-generate.ts`
- summary-related chat UI components, if needed

Tasks:

- Handle metadata patch stream events.
- Invalidate or refresh the relevant chat detail query.
- Confirm summary UI updates after background metadata changes.

### 6. Add Agent Management Support

Files likely affected:

- `packages/client/src/components/agents/AgentEditor.tsx`
- `packages/client/src/components/panels/AgentsPanel.tsx`
- `packages/server/src/services/storage/agents.storage.ts`
- `packages/shared/src/types/agent.ts`

Tasks:

- Add any necessary summary-agent type, defaults, or configuration affordances.
- Ensure allowed tools are clear and constrained.
- Ensure the UI communicates enabled/disabled state through existing patterns.

### 7. Verification

- Run `pnpm check`.
- Run targeted manual generation tests with the summary agent enabled.
- Verify a summary update persists to chat metadata.
- Verify summary UI updates without a full page refresh.
- Verify generation still works when the summary agent is disabled.
- Verify unrelated tools and custom tools still execute.

## Files Affected

Expected areas:

- `packages/shared/src/types/agent.ts`
- `packages/shared/src/schemas/agent.schema.ts`
- `packages/server/src/services/tools/tool-executor.ts`
- `packages/server/src/services/agents/agent-executor.ts`
- `packages/server/src/services/agents/agent-pipeline.ts`
- `packages/server/src/routes/generate.routes.ts`
- `packages/server/src/routes/generate/retry-agents-route.ts`
- `packages/client/src/hooks/use-generate.ts`
- `packages/client/src/components/agents/AgentEditor.tsx`
- `packages/client/src/components/panels/AgentsPanel.tsx`

Final implementation may narrow this list after design iteration.

## Rollback

- Revert the CR branch commits.
- Remove summary-agent configuration and summary tool definitions.
- Revert metadata I/O context changes and SSE metadata patch handling.
- Confirm `pnpm check` passes after rollback.
