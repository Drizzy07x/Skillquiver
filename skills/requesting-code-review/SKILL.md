---
name: requesting-code-review
description: Dispatches a bounded reviewer and preserves verified findings. Use when completed work needs read-only review before merge.
---

# Requesting Code Review

Review completed work against its requirements before it cascades. Give the
reviewer the work product and exact review range, never the whole session
history.

## Choose the path

Handle a standalone bounded read-only code review directly.

- For a user's standalone bounded read-only review, inspect and report it
  directly. Read only the named file and directly required context. Do not edit
  the code. Do not enumerate the workspace.
- For completed implementation work, dispatch a reviewer after a meaningful
  task, major feature, complex fix, or before merge.
- For one small file, use at most one reviewer unless its result lacks named
  evidence; explain the missing evidence to any follow-up reviewer.

For the direct path, format each finding as
`- <Severity>: <path>:<line> - <defect>. <impact and reasoning>.` Use a plain
`path:line` when a valid clickable absolute path is unavailable.
Every finding must name the defect, impact, and reasoning.
Never output a placeholder, empty link, or unfinished finding.

## Define the review range

Prefer the base commit recorded before implementation. Otherwise derive it from
the confirmed base branch:

```bash
BASE_SHA=$(git merge-base <base-branch> HEAD)
HEAD_SHA=$(git rev-parse HEAD)
```

Never default to `HEAD~1`; it silently omits earlier commits in a multi-commit
task. On Windows, run these Bash commands in a Bash-capable shell or use their
PowerShell equivalents.

## Dispatch

Fill [code-reviewer.md](code-reviewer.md) with:

- `[DESCRIPTION]`: concise summary of the completed work;
- `[PLAN_OR_REQUIREMENTS]`: authoritative behavior and constraints;
- `[BASE_SHA]` and `[HEAD_SHA]`: complete range to inspect.

Use the host's general-purpose worker or closest equivalent. Keep the review
read-only and require exact file/line evidence, calibrated severity, reasoning,
and a merge verdict.

## Preserve and resolve findings

Maintain one accumulator of verified findings across every reviewer response.
A later "no additional findings" must never erase an earlier verified issue.

Verify each finding against the code and requirements before acting. Fix
Critical and Important defects before continuing. When a finding is wrong,
respond with technical evidence from code or tests rather than deference. After
a material fix, request a focused re-review of the changed evidence, not an
unbounded restart.

The final user-facing review is the severity-ordered synthesis of the
accumulator with exact file and line references. Do not forward an intermediate
reviewer message as the final verdict. State reviewed scope and any unverified
surface explicitly.
