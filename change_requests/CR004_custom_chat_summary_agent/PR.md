## Why this change

Custom agents can participate in generation, but they did not have a clean way to maintain durable chat memory. This change lets users build their own memory agents that can read the current chat summary, append durable updates, and run on a configurable cadence without replacing the built-in summary agent.

## What changed

- Added `read_chat_summary` and `append_chat_summary` built-in tool definitions and execution support.
- Added route-owned chat metadata patching so summary tool updates persist and stream a `metadata_patch` event back to the client.
- Passed summary-capable tool context through eligible custom agent execution.
- Refreshed chat detail state on metadata patch events so summary UI can reflect background memory updates.
- Added custom-agent cadence settings so agents can run every N eligible chat messages instead of on every generation.
- Preserved existing upstream Knowledge Router behavior and stripped local-only workflow artifacts from the PR branch.

## Validation

- [x] `pnpm check`
- [ ] Manual verification completed (describe below)

### Manual verification notes

- Not completed in this session.
- Create a custom agent with the documented memory-keeper prompt, allow it to use summary tools, generate a chat response, and verify the persisted summary updates.
- Configure the custom agent to run every N eligible chat messages and verify it does not run before the cadence threshold is met.
- Verify summary UI refreshes when the custom agent updates metadata.
- Verify tools still execute for normal agents and do not regress existing custom-tool behavior.
- Verify the existing built-in chat summary agent still works or remains unaffected.
- Verify disabled custom memory-agent configuration has no side effects.
- Verify generation still works when the custom memory agent is disabled.
- Verify a summary update persists to chat metadata.
- Verify unrelated tools and custom tools still execute.

## Docs and release impact

- [x] No docs changes needed. Not applicable: this PR does not change install, update, release, or user-facing documentation behavior.
- [ ] Updated docs (README / CONTRIBUTING / android/README / CHANGELOG) as needed
- [ ] Version/release files updated. Not applicable: this PR does not include a version bump or release metadata change.

## UI evidence (if applicable)

No screenshots or recordings captured.
