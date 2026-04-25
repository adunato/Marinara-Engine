---
name: marinara-change-request
description: Create and manage Marinara-Engine change requests. Use when Codex needs to start a new CR, create change_requests/CRXXX_* documentation, create a change/CRXXX-* branch, draft or update HLD and implementation plans, or align work with this project's change request practice.
---

# Marinara Change Request

Use this skill only in the Marinara-Engine repository.

This project also has the generic `change-request` skill. Follow that structure, with these Marinara-specific rules.

## CR Numbering

1. Inspect `change_requests/`.
2. Pick the next `CRXXX` number after the highest existing CR folder.
3. Use folder names like `change_requests/CR003_short_title`.
4. Use branch names like `change/CR003-short-title`.

## Required Files

Each CR folder must contain:

- `HLD.md`
- `IMPLEMENTATION_PLAN.md`

Keep these files in `change/CRXXX-*` and `local-tools`. Remove them from upstream PR branches unless the user explicitly wants the docs included upstream.

## New CR Workflow

1. Start from the appropriate base branch. Use `main` for local development unless the user specifies otherwise.
2. Create and switch to `change/CRXXX-short-title`.
3. Create `HLD.md` with title, status, goals, proposed solution, risks, and validation.
4. Create `IMPLEMENTATION_PLAN.md` with prerequisites, atomic tasks, files affected, verification, and rollback.
5. Commit only the CR docs with a message like `docs: init CRXXX short title`.
6. Ask for HLD approval before writing implementation code when starting a brand-new change.

## Implementation Rules

- Read `AGENTS.md` first.
- Read `packages/client/.instructions.md` before editing client code.
- Use `pnpm check` as the baseline validation command.
- Use `pnpm db:push` when server or database schema behavior changes.
- Use `pnpm version:check` when touching release metadata or version-bearing files.
