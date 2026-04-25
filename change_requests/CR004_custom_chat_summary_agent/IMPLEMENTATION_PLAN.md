# Implementation Plan: Enable Custom Chat Memory Agents

## Prerequisites

- Start from refreshed `upstream-main`, after fetching and integrating the latest `Pasta-Devs/main`.
- Review CR001 and CR003 only as historical context; this CR is the implementation source of truth.
- Read `packages/client/.instructions.md` before editing client code.

## Step-by-Step Tasks

### 1. Confirm Scope and Agent Configuration Assumptions

- Confirm this CR enables user-built custom agents; it does not implement or ship a canonical custom memory agent.
- Confirm no UI template or preset is required.
- Confirm validation can use a post-processing custom agent, but implementation must not hardcode a special memory-agent phase.
- Confirm custom-agent trigger cadence is a generic setting for all custom agents, not a summary-specific scheduler.
- Confirm summary-aware context trimming is out of scope and belongs in a future CR.
- Confirm coexistence with the built-in summary agent is first-come, first-served and must not crash.

### 2. Define Summary Tool Contracts

Files likely affected:

- `packages/shared/src/types/agent.ts`
- `packages/shared/src/schemas/agent.schema.ts`
- `packages/server/src/services/tools/tool-executor.ts`

Tasks:

- Define `read_chat_summary`.
- Define `append_chat_summary`.
- Do not define a generic chat-memory update tool, replacement tool, or structured memory patch tool.
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

- Add any necessary configuration affordances for user-built custom memory agents.
- Add a generic custom-agent trigger cadence setting that can run an agent every N eligible chat messages.
- Ensure allowed tools are clear and constrained.
- Ensure the UI communicates enabled/disabled state through existing patterns.
- Do not replace or migrate the built-in chat summary agent in this CR.

### 7. Document Test Agent Prompt

- Add manual test documentation for a custom chat memory agent prompt.
- Use this initial prompt for verification:

```text
You are the chat memory keeper. After each assistant response, review the recent conversation and the existing chat summary. If the new exchange includes durable facts, relationship changes, preferences, plans, unresolved tasks, or important story developments, update the chat summary using the available summary tool.

Keep the summary concise and cumulative. Preserve important existing context. Do not include transient wording, repetitive dialogue, or details that are unlikely to matter later. If no durable memory update is needed, do not call the update tool.
```

### 8. Verification

- Run `pnpm check`.
- Run targeted manual generation tests with a user-built custom memory agent enabled.
- Verify custom-agent trigger cadence by configuring the agent to run every N eligible chat messages.
- Verify a summary update persists to chat metadata.
- Verify summary UI updates without a full page refresh.
- Verify generation still works when the custom memory agent is disabled.
- Verify the built-in chat summary agent remains unaffected.
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
- Remove custom memory-agent configuration changes and summary tool definitions.
- Revert metadata I/O context changes and SSE metadata patch handling.
- Confirm the built-in chat summary agent behavior is unchanged.
- Confirm `pnpm check` passes after rollback.
