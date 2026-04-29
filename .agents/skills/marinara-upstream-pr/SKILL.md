---
name: marinara-upstream-pr
description: Prepare Marinara-Engine changes for upstream contribution. Use when Codex needs to turn a completed change/CRXXX-* branch into a clean pr/CRXXX-* branch, strip local-only artifacts, validate the upstream-ready diff, merge into upstream-main, or prepare a PR to pastadevs/main.
---

# Marinara Upstream PR

Use this skill only in the Marinara-Engine repository.

## Branch Intent

- Source work comes from `change/CRXXX-*`.
- Upstream-ready work goes to `pr/CRXXX-*`.
- `upstream-main` is the clean integration branch for upstream PRs into `pastadevs/main`.
- `local-tools` and `main` may contain local-only artifacts that must not leak upstream.

## Local-Only Artifacts To Strip

Remove these from `pr/CRXXX-*` unless the user explicitly requests otherwise:

- `.agents/skills/`
- `.agents/scripts/`
- `AGENTS.md`
- `change_requests/`
- `start_dev_client.bat`
- `start_dev_server.bat`
- `start_dev_server_logged.bat`
- `filter_server_log.bat`
- `filter_server_log.ps1`
- local-only `.gitignore` changes
- design documents, scratch notes, or utility scripts not intended for `pastadevs/main`

## PR Branch Workflow

1. Confirm the completed CR branch and the intended CR number.
2. Read `change_requests/tracker.md` and confirm the CR is active, not `archived`.
3. Run the repo-local PR branch helper from the repository root:

   ```powershell
   .\.agents\scripts\new-upstream-pr.ps1 -SourceBranch change/CRXXX-short-title -PrBranch pr/CRXXX-short-title
   ```

4. Use `-ResetExisting` only when the user explicitly wants to recreate an existing `pr/CRXXX-*` branch from `upstream-main`.
5. Use `-NoValidate` only when the user asks for a narrower or deferred validation pass.
6. Review the helper's `git diff --name-status upstream-main..HEAD` output and confirm local-only artifacts are absent.
7. Run additional validation required by the touched areas, such as `pnpm db:push` or `pnpm version:check`.
8. Update `change_requests/tracker.md` when the CR status changes:
   - `PR open into origin main` after a PR is actually opened into the target main branch.
   - `merged into origin main` after that PR is merged.
   - Add the PR URL or target branch in `Notes` when known.
9. Merge into `upstream-main` only after the user confirms the PR branch is ready.

The helper fetches `upstream/main` into `upstream-main`, creates the PR branch from `upstream-main`, cherry-picks source commits, strips the local overlay paths, and runs `pnpm check` by default.

## PR Description Guidance

Make the why explicit. Include:

- user problem or rationale
- concise implementation summary
- validation performed
- known limitations or follow-up work

Do not push or create the GitHub PR unless the user explicitly asks.
