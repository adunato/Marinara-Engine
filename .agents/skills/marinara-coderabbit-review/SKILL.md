---
name: marinara-coderabbit-review
description: Use when working in the Marinara Engine repo with CodeRabbit PR review comments, especially when the user asks to triage, plan, summarize, or address CodeRabbit observations. Produces a structured review-response plan that maps each CodeRabbit observation and recommendation to a verified proposed solution before implementation.
---

# Marinara CodeRabbit Review

## Core Workflow

1. Verify every CodeRabbit finding against the current branch before accepting it.
   - Inspect the referenced file and nearby code.
   - Check whether newer commits already fixed the issue.
   - Separate actionable bugs from documentation nits and stale comments.

2. Produce a structured plan before editing for every new CodeRabbit review batch.
   - Do this even when the user asks to address, fix, or implement the comments.
   - Skip the plan only when the user explicitly says to proceed without planning or when continuing an already approved plan.
   - Keep CodeRabbit's observation and recommendation distinct from the proposed local solution.
   - Wait for user approval before editing code, docs, tests, or workflow files.
   - For trivial nits only, a compact plan is acceptable, but it must still identify the observed issue and proposed change.
   - Use this shape for each item:

```markdown
### N. Short Finding Title

**CodeRabbit observation and recommendation**

Summarize what CodeRabbit observed and what it recommended.

**Proposed solution**

State exactly what should change in this repo after verification.
```

3. Group related comments when they share one implementation.
   - Example: metadata race comments in route code and tool code should be planned as one metadata update contract.
   - Example: duplicate UI constants should be planned as one shared helper extraction.

4. Include a compact validation section.
   - Always include `pnpm check` unless there is a clear reason not to run it.
   - Add targeted commands when useful, such as:
     - `pnpm --filter @marinara-engine/server lint`
     - `pnpm --filter @marinara-engine/client lint`
     - `pnpm --filter @marinara-engine/client build`
   - Include manual verification notes for UI or generation behavior that tests do not cover.

## Implementation Guidance

When the user asks to implement the approved plan:

- Keep edits scoped to the reviewed branch and comments.
- Do not treat CodeRabbit suggestions as automatically correct; preserve current behavior where the comment is stale or wrong.
- Prefer small, behavior-focused commits that clearly correspond to the review response.
- Update CR docs when the review comment is about documented behavior or when implementation semantics changed.
- Run formatting only on files you touched.
- Run validation before committing.

## Marinara-Specific Review Patterns

- Metadata writes: document and implement clear merge semantics. Prefer shallow top-level patching unless the reviewed requirement explicitly needs deeper behavior.
- Agent cadence: keep labels, ranges, parsing, and `Every run` behavior shared across agent editor and chat settings surfaces.
- Tool execution: keep main assistant and agent tool contexts aligned so built-in tools receive the same required context.
- CR branches: implementation fixes belong on the active `change/CRXXX-*` branch. Local workflow skills or repo-maintenance artifacts belong on `local-tools`, not upstream PR branches.
