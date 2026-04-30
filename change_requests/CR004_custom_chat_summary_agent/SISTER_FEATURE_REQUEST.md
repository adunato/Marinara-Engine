# Feature Request: Enable Custom Chat Memory Agents

## Problem

Users can create custom agents, but those agents cannot maintain the persisted chat summary during generation. Custom agents also lack a configurable run cadence, so memory-style agents run too often preventing a sensible memory summarisation task. These limitations affect users who want to build their own memory workflows instead of relying only on the built-in summary agent.

## Goals

- Let custom agents read the current chat summary.
- Let custom agents append durable updates to the chat summary.
- Persist summary updates during generation and refresh summary-dependent UI.
- Let custom agents run on a configurable cadence instead of every generation.
- Keep the built-in summary agent working independently.

## Requirements

- Add `read_chat_summary` for reading the current persisted chat summary.
- Add `append_chat_summary` for appending durable updates to the persisted chat summary.
- Provide tool execution with safe access to chat metadata.
- Persist metadata changes through the server route, not directly inside tools.
- Notify the client when metadata changes so the summary UI can refresh.
- Expose cadence settings only for custom agents, without changing built-in agent cadence behavior.

## Proposed Solution

Add `read_chat_summary` and `append_chat_summary` tools to the built-in tool set, then pass generation agents a route-owned tool context that can read current chat metadata and request metadata patches. The route persists patches, updates request-local metadata, and emits a metadata change event to the client. Custom agents get a generic run cadence setting based on user-message count, while built-in agents keep their existing interval behavior.
