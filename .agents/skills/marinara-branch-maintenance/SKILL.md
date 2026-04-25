---
name: marinara-branch-maintenance
description: Maintain the local branch model for Marinara-Engine. Use when Codex needs to reset or rebuild main from upstream-main, reapply the local-tools overlay, inspect or update local-only tooling artifacts, or explain this repository's fork branch strategy.
---

# Marinara Branch Maintenance

Use this skill only in the Marinara-Engine repository.

## Branch Model

- `upstream-main`: clean upstream-compatible branch used for updates and PRs into `pastadevs/main`.
- `main`: local development branch. It can contain new features, experiments, utilities, and non-upstream artifacts.
- `local-tools`: local overlay branch for repo maintenance artifacts reapplied after refreshing `main` from `upstream-main`.
- `change/CRXXX-*`: working branches for individual change requests.
- `pr/CRXXX-*`: upstream-ready PR branches derived from completed CR work.

## Local Overlay Contents

Keep `local-tools` limited to local repo workflow artifacts:

- `.agents/skills/`
- `AGENTS.md`
- `.gitignore`
- `change_requests/`
- `start_dev_client.bat`
- `start_dev_server.bat`

If another local-only artifact is needed, add it deliberately and update `AGENTS.md` in the same change.

## Rebuild Main Workflow

Before any destructive operation:

1. Confirm the current branch and working tree with `git status --short --branch`.
2. Preserve or commit unrelated work. Never reset over user changes without explicit instruction.
3. Verify `upstream-main` and `local-tools` exist locally.

To rebuild `main` when explicitly asked:

1. Switch to `main`.
2. Reset or overwrite `main` from `upstream-main` as requested by the user.
3. Merge `local-tools` into `main`.
4. Resolve conflicts by preserving upstream product code and local overlay artifacts.
5. Run `git status --short --branch` and summarize the resulting state.

Do not push unless the user explicitly asks.
