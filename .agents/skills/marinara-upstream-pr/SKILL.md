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
- `AGENTS.md`
- `change_requests/`
- `start_dev_client.bat`
- `start_dev_server.bat`
- local-only `.gitignore` changes
- design documents, scratch notes, or utility scripts not intended for `pastadevs/main`

## PR Branch Workflow

1. Confirm the completed CR branch and the intended CR number.
2. Fetch `upstream main` and fast-forward local `upstream-main` to `upstream/main`.
3. Create or update `pr/CRXXX-short-title` from `upstream-main`.
4. Cherry-pick or apply only upstream-relevant commits from `change/CRXXX-*`.
5. Exclude local-only artifacts listed above.
6. Validate the resulting diff against `upstream-main` with `git diff --name-status upstream-main..HEAD`.
7. Run `pnpm check` unless the user asks for a narrower validation.
8. Run additional validation required by the touched areas, such as `pnpm db:push` or `pnpm version:check`.
9. Merge into `upstream-main` only after the user confirms the PR branch is ready.

## PR Description Guidance

Make the why explicit. Include:

- user problem or rationale
- concise implementation summary
- validation performed
- known limitations or follow-up work

Do not push or create the GitHub PR unless the user explicitly asks.
