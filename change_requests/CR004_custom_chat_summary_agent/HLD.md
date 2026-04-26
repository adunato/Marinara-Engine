# Title: Enable Custom Chat Memory Agents
## Status: Draft

## Background

Marinara needs first-class support for user-built custom agents that can maintain chat memory during generation. Earlier design work explored two parts of this problem:

- CR001 proposed explicit built-in tools for reading and appending chat summaries.
- CR003 proposed a generalized metadata I/O bridge so tools can read and patch chat metadata without depending on route-specific database handles.

This CR combines those requirements into a standalone design for enabling custom chat memory agents and the supporting tool, agent-management, and metadata-sync improvements. CR001 and CR003 remain useful references, but this document should be sufficient on its own.

This CR does not replace the existing built-in chat summary agent. The new capability should work as an alternative or complementary path for users who want to build their own memory agents. A future CR may decide to migrate the built-in summary agent onto the same tool-based implementation, but that is out of scope here.

## Problem Statement

Chat summaries are long-term conversation memory, but custom agents do not currently have a clean way to read and update that memory during generation. Users should be able to build their own chat memory agents that have access to the current chat context and can update persisted summary metadata without leaking database concerns into tool implementations.

The current direction also needs to avoid brittle tool context plumbing. Built-in and custom tools should receive a stable execution context that exposes chat metadata through a read/write bridge rather than requiring individual tools to know about `db`, `chatId`, or route internals.

## Goals

- Enable user-built custom agents to maintain chat memory as part of chat generation.
- Provide explicit summary-oriented tool behavior for reading the current summary and appending summary updates.
- Introduce or refine a generalized tool metadata I/O context so metadata-aware tools are decoupled from database and route internals.
- Ensure summary updates triggered by custom agents are persisted consistently.
- Ensure the client refreshes summary-dependent UI when background summary metadata changes.
- Improve agent management for custom memory agents by making tool eligibility visible, making generation-phase selection explicit, documenting the recommended memory-agent prompt, and exposing enough execution/failure state to understand whether the agent ran and whether it updated memory.
- Add a generic custom-agent trigger cadence setting so users can run custom agents every N eligible chat messages instead of on every generation.
- Preserve the existing built-in chat summary agent as a separate, compatible feature.
- Keep the design compatible with the upstream PR workflow by avoiding local-only artifacts in implementation commits.

## Non-Goals

- Building or shipping a single canonical custom chat memory agent as product behavior.
- Replacing, removing, or migrating the existing built-in chat summary agent.
- Reworking the entire agent system beyond what is needed to enable custom memory-agent support.
- Introducing a full memory subsystem for all metadata types.
- Redesigning chat storage or changing the persisted chat metadata format unless required for summary updates.
- Adding summary-aware context trimming, such as limiting prompt context to messages since the last summary update. Users can manage context manually for now; automated trimming should be handled in a future CR.
- Shipping CR001 or CR003 as separate implementation lines.

## Proposed Solution

### 1. Summary Tools

Provide summary-oriented tool capabilities:

- `read_chat_summary`: returns the current persisted summary from chat metadata.
- `append_chat_summary`: accepts summary text to append to the persisted summary.

No generic "update chat memory" or summary replacement tool is in scope for this CR. Tool behavior should not depend directly on route database handles.

### 2. Generalized Tool Metadata I/O

Update tool execution context to expose chat metadata through stable read/write primitives:

```ts
chatMeta?: Record<string, unknown>;
onUpdateMetadata?: (patch: Record<string, unknown>) => Promise<void>;
```

Tools should read from `chatMeta` and write by calling `onUpdateMetadata`. Route-level orchestration remains responsible for persistence, local metadata merging, and client notification.

### 3. Route Orchestration

Generation routes should construct a shared tool context for the main assistant and all agents. The context should:

- include parsed chat metadata for fast reads;
- persist metadata patches through existing chat storage;
- merge patches into the in-memory metadata object used during the request;
- emit a metadata-change signal to the client stream when a patch is applied.

This should also reduce duplicated tool-preparation logic where possible.

### 4. Client Metadata Refresh

The client should respond to a metadata patch event, such as `metadata_patch`, by invalidating or refreshing the relevant chat detail query. Summary popovers or other summary UI should update without requiring a manual page refresh.

### 5. Agent Management Improvements

Agent management should make it possible to create and configure custom memory agents using existing patterns. The expected improvements are:

- Tool configuration clearly shows whether the agent can use the summary read/update tools.
- Generation-phase configuration makes it clear when the agent runs; validation can use a post-processing custom agent, but this CR should not hardcode a special phase for memory agents.
- Trigger cadence configuration lets users run a custom agent every N eligible chat messages, using a generic custom-agent setting rather than summary-specific scheduling.
- Documentation includes a recommended test prompt so users can create their own memory agent without relying on a shipped canonical agent.
- Execution feedback or logs make it possible to tell whether the agent ran, skipped, failed, or successfully patched chat metadata.
- Coexistence behavior is documented for chats that also use the built-in summary agent.

## Test Agent Prompt

Use a documented custom agent prompt during manual verification. Initial test prompt:

```text
You are the chat memory keeper. After each assistant response, review the recent conversation and the existing chat summary. If the new exchange includes durable facts, relationship changes, preferences, plans, unresolved tasks, or important story developments, update the chat summary using the available summary tool.

Keep the summary concise and cumulative. Preserve important existing context. Do not include transient wording, repetitive dialogue, or details that are unlikely to matter later. If no durable memory update is needed, do not call the update tool.
```

## Open Questions

These have been answered and are recorded here to constrain implementation scope:

- Generation phase: not a product-scope decision for this CR. Users create and configure their own custom agents. Validation may use a post-processing agent, but implementation must not assume memory agents require a special phase.
- Trigger cadence: custom agents should support a generic every-N-messages trigger cadence. This is not specific to summary agents, but it is required for MVP so memory agents can avoid running every generation.
- Summary tool contract: only `read_chat_summary` and `append_chat_summary` are in scope. No generic chat-memory update tool, replacement tool, or structured memory patch tool is in scope.
- UI template or preset: no template or preset is required. Documentation of the prompt and required tools is sufficient for this CR.
- Context trimming: automatic trimming to messages since the last summary update is out of scope for this CR. It can be done manually for now and should be considered as a future CR.
- Built-in and custom-agent coexistence: if both update the same summary, the outcome is first-come, first-served. The system must handle the race without crashing, but it does not manage or reconcile user-created agents that intentionally operate on the same data pool.

## Risks and Mitigations

- Risk: automatic summary updates may become noisy or grow low-value memory.
  Mitigation: document prompt guidance that only durable facts, preferences, plans, unresolved tasks, and important story developments should be saved; manual testing should include a no-update case.
- Risk: not all agent execution paths currently receive equivalent tool context.
  Mitigation: pass the same summary-capable tool context through the main assistant path and all eligible agent execution paths, then verify with a custom memory agent.
- Risk: client invalidation may refetch too often during long streams.
  Mitigation: emit metadata patch events only when metadata is actually patched, and invalidate the chat detail query from that event rather than on every streamed token.
- Risk: custom memory agents could race with the built-in summary agent when both update the same summary.
  Mitigation: treat this as user configuration responsibility; ensure concurrent or near-concurrent summary writes do not crash the system and validate that the built-in summary agent remains unaffected by the new custom-agent tooling.

## Validation

- `pnpm check` passes.
- Manual test: create a custom agent with the documented memory-keeper prompt, allow it to use summary tools, generate a chat response, and verify the persisted summary updates.
- Manual test: configure the custom agent to run every N eligible chat messages and verify it does not run before the cadence threshold is met.
- Manual test: verify summary UI refreshes when the custom agent updates metadata.
- Manual test: verify tools still execute for normal agents and do not regress existing custom-tool behavior.
- Manual test: verify the existing built-in chat summary agent still works or remains unaffected.
- Manual test: verify disabled custom memory-agent configuration has no side effects.
