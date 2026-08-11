---
name: requesting-code-review
description: Dispatches a code-reviewer subagent to check finished work against requirements before it merges. Use when completing tasks, implementing major features, or before merging.
---

# Requesting Code Review

Dispatch a code reviewer subagent to catch issues before they cascade. The reviewer gets precisely crafted context for evaluation — never your session's history.

**Core principle:** Review early, review often.

## When to Request Review

**Mandatory:**
- After each task in subagent-driven development
- After completing major feature
- Before merge to main

**Optional but valuable:**
- When stuck (fresh perspective)
- Before refactoring (baseline check)
- After fixing complex bug

## How to Request

**1. Get git SHAs:**
```bash
# Prefer the commit recorded before implementation. If it was not recorded,
# derive it from the confirmed base branch.
BASE_SHA=$(git merge-base <base-branch> HEAD)
HEAD_SHA=$(git rev-parse HEAD)
```

Never default to `HEAD~1`: a multi-commit task would review only its final
commit and silently omit the rest of the implementation.

Commands in this skill use Bash syntax — on Windows, run them in a Bash-capable shell such as Git Bash, not PowerShell.

**2. Dispatch code reviewer subagent:**

Dispatch a reviewer using the host's general-purpose worker role or its closest equivalent, filling the template at [code-reviewer.md](code-reviewer.md).

**Placeholders:**
- `[DESCRIPTION]` - Brief summary of what you built
- `[PLAN_OR_REQUIREMENTS]` - What it should do
- `[BASE_SHA]` - Starting commit
- `[HEAD_SHA]` - Ending commit

**3. Act on feedback:**

Process reviewer findings per the receiving-code-review skill — verify before implementing, fix Critical and Important issues before proceeding, push back with technical reasoning when the reviewer is wrong.

## Example

```
[Just completed Task 2: Add verification function]

You: Let me request code review before proceeding.

BASE_SHA=$(git merge-base main HEAD)
HEAD_SHA=$(git rev-parse HEAD)

[Dispatch code reviewer subagent]
  DESCRIPTION: Added verifyIndex() and repairIndex() with 4 issue types
  PLAN_OR_REQUIREMENTS: Task 2 from docs/plans/deployment-plan.md
  BASE_SHA: a7981ec
  HEAD_SHA: 3df7661

[Subagent returns]:
  Strengths: Clean architecture, real tests
  Issues:
    Important: Missing progress indicators
    Minor: Magic number (100) for reporting interval
  Assessment: Ready to proceed

You: [Fix progress indicators]
[Continue to Task 3]
```

## Common Rationalizations

| Excuse | Reality |
|--------|---------|
| "I'll just review the diff myself instead of dispatching a reviewer" | You're the coordinator — reviewing the diff inline burns the context window you need to keep driving the work. Dispatch a reviewer subagent: the diff and the evaluation live in its context, and only the findings come back to you. |
| "The reviewer needs my whole session history to understand the change" | Hand it precisely crafted context, never your session's history. That keeps the reviewer on the work product, not your thought process. |

## Red Flags

**Never:**
- Skip review because "it's simple"
- Ignore Critical issues
- Proceed with unfixed Important issues
- Argue with valid technical feedback

**If reviewer wrong:** process the finding per receiving-code-review (push back with technical reasoning, show code/tests that prove it works).
