# AGENTS.md

This file is a thin maintainer note for contributors using Codex. Canonical workflow, validation, and release guidance lives in `CONTRIBUTING.md`.

## Preferred Workflow

- Start with `pnpm install`.
- Run `pnpm check` as the baseline validation command.
- Run `pnpm db:push` when server or database changes need schema verification.
- Run `pnpm version:check` when you touch release metadata, version-bearing files, or README release references.

## Repo-Specific Cautions

- Keep edits non-destructive. Do not revert unrelated work in the tree.
- Prefer focused patches that keep code, docs, and release metadata aligned in the same change.
- When preparing a PR, make the why explicit in the description so reviewers can see the user problem or rationale, not just the file changes.
- Check `README.md`, `android/README.md`, `CONTRIBUTING.md`, `CHANGELOG.md`, `docs/CONFIGURATION.md`, `docs/TROUBLESHOOTING.md`, and `docs/FAQ.md` together when install, update, or release behavior changes.

## Branch Purpose

This repository is a fork of the `pastadevs/marinara-engine` project. Keep branch intent clear so local development work stays separate from upstream-ready changes.

- `main`: local development branch for new features, experiments, utility scripts, and other work not necessarily intended for upstream use.
- `upstream-main`: clean branch for upstream updates and pull requests into `pastadevs/main`.
- `local-tools`: local overlay branch for repository maintenance artifacts that should be reapplied after refreshing `main` from `upstream-main`.
- `change/CRXXX`: per-change working branches mapped to a change request, following the change request skill practice.
- `pr/CRXXX`: upstream-ready PR branches created after a change is completed and tested. Strip non-upstream artifacts such as design documents before merging these branches into `upstream-main`.

Use the repo-local skills for detailed project workflows:

- `$marinara-branch-maintenance`: rebuild `main` from `upstream-main`, maintain `local-tools`, and manage local overlay artifacts.
- `$marinara-change-request`: create and manage `change/CRXXX` branches and `change_requests/` docs.
- `$marinara-coderabbit-review`: triage, verify, plan, and address CodeRabbit PR review comments.
- `$marinara-pr-description`: draft or update `change_requests/CRXXX_*/PR.md` from the repository PR template.
- `$marinara-upstream-pr`: prepare clean `pr/CRXXX` branches with `.agents/scripts/new-upstream-pr.ps1` before upstream PR work.

Keep `change_requests/tracker.md` current when CR state changes, including creation, archive/supersession, local merge, PR opening, and PR merge.

## Version Truth

- Canonical version: root `package.json`
- Release tag format: `vX.Y.Z`
- Release-notes source: `CHANGELOG.md`
- Derived version files that must stay in sync:
  - `packages/client/package.json`
  - `packages/server/package.json`
  - `packages/shared/package.json`
  - `packages/shared/src/constants/defaults.ts`
  - `installer/installer.nsi`
  - `installer/install.bat`
  - `android/app/build.gradle`

Android-specific rule:

- `versionName` matches the app version.
- `versionCode` increments for every shipped APK.

## Safe Multi-File Updates

- When changing version numbers, bump root `package.json` first, then run `pnpm version:sync -- --android-version-code <next-code>`.
- Run `pnpm version:check` before tagging or publishing.
- Keep `CONTRIBUTING.md` authoritative. Add Codex-specific notes here only when they are operationally useful and not already covered there.

## Frontend Changes

- **Read `packages/client/.instructions.md` before editing any client code.** It is the authoritative reference for architecture, patterns, conventions, and common-mistake avoidance.
- Validate with `pnpm check` (TypeScript + ESLint). There is no automated test suite.
