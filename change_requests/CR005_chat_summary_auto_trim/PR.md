## Why this change

The existing context limit only supports a fixed last-N message ceiling, so it cannot tell when older messages have already been captured by Chat Summary. That can keep sending summarized history back to the model unnecessarily, or force users to choose a limit that cuts away unsummarized recent context. This change adds an optional summary-aware trim mode that excludes messages already covered by the last trusted Chat Summary update without deleting any persisted chat history.

## What changed

- Added `chatSummarySnapshot` metadata to record the trusted Chat Summary update source, anchor message, previous anchors, covered count, and summary length.
- Added `trimAfterChatSummary` metadata and generation-time context trimming that treats the Chat Summary marker as the floor and the existing message limit as the ceiling.
- Stamped summary snapshots from the built-in Chat Summary agent, the Chat Summary Generate button, and `append_chat_summary` tool usage.
- Kept manual summary edits as plain summary text updates so they do not advance the snapshot marker.
- Added snapshot fallback handling for deleted anchors and branch remapping that preserves summary text while remapping, promoting, or clearing snapshot anchors safely.
- Added the `Trim After Chat Summary` control and status text to the Context Limit section of chat settings.

## Validation

- [x] `pnpm check`
- [ ] Manual verification completed (describe below)

### Manual verification notes

- Manual runtime verification has not been completed for this PR draft.

## Docs and release impact

- [ ] No docs changes needed
- [x] Updated docs (README / CONTRIBUTING / android/README / CHANGELOG) as needed
- [ ] Version/release files updated (only if this PR includes a version bump)

Updated CR005 HLD and implementation plan documents. No version or release metadata changes are included.

## UI evidence (if applicable)

UI changes apply to the Context Limit section in chat settings. Screenshot or recording evidence has not been captured.
