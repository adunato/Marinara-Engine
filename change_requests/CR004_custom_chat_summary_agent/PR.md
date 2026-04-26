## Why this change

Custom agents can already perform user-defined tasks, but they did not have a safe way to maintain the persisted chat summary as part of normal chat generation. This change enables user-built memory agents to read the current chat summary and append new durable summary content, while keeping the existing built-in Automated Chat Summary agent available as a complementary option.

## What changed

- Added built-in `read_chat_summary` and `append_chat_summary` tools for agents.
- Wired summary tools into generation so custom agents can read and append persisted chat summary metadata.
- Added metadata patch handling so client chat data refreshes after summary tool updates.
- Added generic trigger cadence for custom agents via `settings.runInterval`.
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
- Verified custom-agent trigger cadence can be configured when editing an agent and when adding an agent to a chat.
- Verified cadence value `1` displays as `Every run` and can be incremented with the explicit stepper controls.

## Docs and release impact

- [ ] No docs changes needed
- [x] Updated docs (README / CONTRIBUTING / android/README / CHANGELOG) as needed
- [ ] Version/release files updated (only if this PR includes a version bump)

Updated CR004 design documentation. No version or release metadata changes are included.

## UI evidence (if applicable)

UI changes apply to the agent editor and add-agent modal. Screenshots were reviewed during manual validation but are not attached here.
