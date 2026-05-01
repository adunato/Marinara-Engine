## What problem does this solve?

Users can create custom agents, but those agents cannot maintain the persisted chat summary during generation. Custom agents also lack a configurable run cadence, so memory-style agents run too often for a sensible memory summarisation task.

These limitations affect users who want to build their own memory workflows instead of relying only on the built-in summary agent.

## Proposed solution

Add chat-summary tools for custom agents:

- `read_chat_summary` for reading the current persisted chat summary.
- `append_chat_summary` for appending durable updates to the persisted chat summary.

Generation agents should receive a route-owned tool context that can read current chat metadata and request metadata patches. The server route should persist those patches, update request-local metadata, and emit a metadata change event so summary-dependent UI can refresh.

Custom agents should also get a generic run cadence setting based on user-message count. The cadence controls should apply only to custom agents, leaving the built-in summary agent's existing interval behavior independent.

## Alternatives considered

- Continue relying only on the built-in summary agent. This does not support user-defined memory workflows.
- Run memory-style custom agents on every generation. This is too frequent for summarisation and can waste work.
- Let tools persist chat metadata directly. The preferred approach is for tools to request metadata patches and for the server route to own persistence.

## Additional context

Desired capabilities:

- Let custom agents read the current chat summary.
- Let custom agents append durable updates to the chat summary.
- Persist summary updates during generation and refresh summary-dependent UI.
- Let custom agents run on a configurable cadence instead of every generation.
- Keep the built-in summary agent working independently.

## Template check

Please **uncheck (untick)** the box below before submitting so we know you read the template. It is intentionally pre-checked:

- [ ] I DID NOT read this template and provide the requested details.
