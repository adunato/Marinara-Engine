# Change Request Tracker

Last updated: 2026-04-27

## States

- `standalone`: Work exists on a CR branch but is not merged into `main` and has no open PR into `origin/main`.
- `merged into main`: Work has been merged into local `main`, but not into `origin/main`.
- `PR open into origin main`: A pull request is open against `origin/main`.
- `merged into origin main`: Work has been merged into `origin/main`.
- `archived`: Work is retained for reference only and should not be continued as an active CR.

## CRs

| CR | State | Title | Short Description | Depends On | Notes |
| --- | --- | --- | --- | --- | --- |
| CR001 | archived | Read & Append Chat Summary Built-In Tools | Adds `read_chat_summary` and `append_chat_summary` tools so agents can read and update persisted chat summaries. | None | Superseded by CR004. Archived under `change_requests/archive/CR001_chat_summary_tools/`. |
| CR002 | PR open into origin main | Universal Agent Tool Support | Enables built-in and custom agents to receive configured tool definitions instead of limiting tool execution to Spotify agents. | None | Open as a PR into `pastadevs/main`. |
| CR003 | archived | Generalized Tool Metadata I/O & Context Repair | Replaces route-specific metadata plumbing with a shared tool context for chat metadata reads, writes, and frontend sync. | CR001, CR002 | Superseded by CR004. Archived under `change_requests/archive/CR003_tool_context_cleanup/`. |
| CR004 | merged into origin main | Enable Custom Chat Memory Agents | Enables user-built custom agents to maintain chat memory using summary tools, metadata updates, client refresh, and agent cadence controls. | None | Supersedes CR001 and CR003. |
| CR005 | merged into origin main | Chat Summary Auto Trim | Adds trusted chat summary snapshot metadata and an optional context mode that excludes already-summarized messages from generation context. | CR004 |  |
