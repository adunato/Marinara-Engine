## Why this change

Custom agents can already perform user-defined tasks, but they were missing three platform capabilities needed for reliable custom memory workflows:

- Built-in tools that can read and append the persisted chat summary.
- A tool execution path that can update chat metadata and hot-patch the client chat state after generation-side changes.
- A generic trigger cadence setting so custom agents can run every N user messages instead of every eligible generation.

Together, these changes enable user-built memory agents to maintain chat summary data as part of normal chat generation, while keeping the existing built-in Automated Chat Summary agent available as a complementary option.

## What changed

- Added built-in `read_chat_summary` and `append_chat_summary` tools for agents.
- Added support for tool execution to update chat metadata and emit a client metadata patch event. The summary tools use this for chat summary updates, but the behavior is part of the shared tool execution path.
- Added generic trigger cadence for custom agents via `settings.runInterval`, allowing all custom agents to run every N user messages.
- Added trigger cadence controls to the agent editor and add-agent modal, including an `Every run` display for cadence value `1`.
- Preserved the existing built-in Automated Chat Summary agent behavior and scope.

## Validation

- [x] `pnpm check`
- [x] `pnpm --filter @marinara-engine/client lint`
- [x] `pnpm --filter @marinara-engine/client build`
- [x] Manual verification completed (describe below)

### Manual verification notes

- Verified the new chat summary tools appear in the agent tool selection UI.
- Verified a custom post-processing agent can use `read_chat_summary` and `append_chat_summary` to append new summary content.
- Verified chat summary tool updates refresh client chat metadata after generation.
- Verified custom-agent trigger cadence can be configured when editing an agent and when adding an agent to a chat.
- Verified cadence value `1` displays as `Every run` and can be incremented with the explicit stepper controls.

## Docs and release impact

- [ ] No docs changes needed
- [x] Updated docs (README / CONTRIBUTING / android/README / CHANGELOG) as needed
- [ ] Version/release files updated (only if this PR includes a version bump)

Updated CR004 design documentation. No version or release metadata changes are included.

## UI evidence (if applicable)

UI changes apply to the agent editor and add-agent modal. Screenshots were reviewed during manual validation but are not attached here.
