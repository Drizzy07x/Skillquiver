# Review and Fix Loop

Read this reference before the first task review. Apply every gate through task completion, then use the final-review section after all tasks finish.

## Task Review

Per-task review is a task-scoped gate. It never replaces the broad whole-branch review.

1. Run `bash <skill-dir>/scripts/review-package PLAN_FILE BASE HEAD`, using the BASE recorded before implementation. Use the printed file path; `HEAD~1` can omit earlier commits from a multi-commit task.
2. Dispatch [task-reviewer-prompt.md](../task-reviewer-prompt.md) with the task brief, implementer report, review package, and binding global constraints.
3. Copy exact values, formats, and relationships from the plan's Global Constraints or specification. The reviewer template already carries process rules.
4. Require both verdicts: spec compliance and task quality. Implementer self-review does not replace either verdict.

The review package keeps the diff out of controller context and gives the reviewer the commit list, stat summary, and full diff in one read. Never dispatch a reviewer without it.

Do not ask the reviewer to repeat tests already evidenced in the implementer report. Add a test request only for a concrete doubt that the existing evidence does not answer. Do not pre-judge findings with instructions such as “do not flag,” “at most Minor,” or “the plan chose.” Let the reviewer raise the issue and adjudicate it through the loop.

A reviewer may return `⚠️ Cannot verify from diff` items. Resolve each one before completing the task. A confirmed gap enters the fix loop as a failed spec review.

Completion criterion: the review contains both verdicts, every `⚠️` item is resolved, and no blocking finding is silently discarded.

## Route Findings

The fix loop starts on spec `❌`, any Critical or Important finding, or a `⚠️` item confirmed as a real gap.

Two routes leave the loop before a fix dispatch:

- Minor findings: append `Task <N>: minor (deferred): <one-liner>` to the ledger. Point the final review at all deferred minors.
- Plan-mandated defects or findings that conflict with the plan: show the finding beside the binding plan text and ask the user which governs.

Everything else enters the loop. Never fix review findings in the controller session; controller fixes pollute coordination context and skip review.

## Fix Rounds

One round is one fix dispatch followed by one scoped re-review. Allow five rounds maximum per task.

### Rounds 1–3

Resume the original implementer with the open findings verbatim. In Codex, use `followup_task` with the original `spawn_agent` target. If the host cannot resume a worker, dispatch a fresh implementer with the brief path, report path, and findings.

### Rounds 4–5

Dispatch a fresh implementer, using a more capable model when supported. Include the brief path, report path, open findings, and this framing:

> A prior implementer attempted this task [N] times; you own it now. Read the report file for what was tried.

### Every Round

1. The implementer fixes the findings, runs the focused tests covering the amended code, and appends the change, test command, and output to the existing report file.
2. Confirm that evidence exists before re-review.
3. Record `FIX_BASE`, the head seen by the previous review.
4. Run `bash <skill-dir>/scripts/review-package PLAN_FILE FIX_BASE HEAD`.
5. Dispatch [re-review-prompt.md](../re-review-prompt.md) with the findings, brief, report, and printed diff path.
6. The re-review verdicts each finding as ADDRESSED or NOT ADDRESSED and checks only the fix diff for new breakage.
7. Ledger out-of-scope observations as deferred minors; they do not extend the loop.
8. Append `Task <N>: fix round <R>/5 (<X> addressed, <Y> open — <finding one-liners>; commits <a7>..<b7>)`.

Completion criterion: the round has covering test evidence, every prior finding has a verdict, new Critical or Important breakage joins the open list, and the ledger records the result.

## Breaker After Round 5

Stop dispatching after the fifth re-review when findings remain. Adjudicate each one:

- Wrong or contestable finding: `Task <N>: parked — <finding> — ruling: <why the code stands>`.
- Real but not load-bearing: park it with a ruling that records the deferral.
- Real and load-bearing for later tasks, or evidence that the plan is defective: append `Task <N>: BLOCKED — <reason>`, stop, and report the finding, conflicting plan text, and fix history to the user.

Adjudication happens only at the cap, and every ruling belongs in the ledger.

## Complete the Task

When review is clean, or every remaining finding is parked at the cap, append one completion line:

- `Task <N>: complete (commits <base7>..<head7>, review clean)`
- `Task <N>: complete (commits <base7>..<head7>, <K> parked)`

Mark the task complete only after this line exists. Continue to the next task only when no unadjudicated Critical or Important issue remains.

## Final Whole-Branch Review

After all tasks complete:

1. Run `bash <skill-dir>/scripts/review-package PLAN_FILE MERGE_BASE HEAD`, where `MERGE_BASE` is the commit from which the branch started.
2. Dispatch the most capable available model with [code-reviewer.md](../../requesting-code-review/code-reviewer.md), the printed package, and pointers to the ledger's deferred-minor and parked lines.
3. If findings remain, dispatch one fix worker with the complete findings list.
4. Run exactly one scoped re-review of that fix wave using `bash <skill-dir>/scripts/review-package PLAN_FILE FIX_BASE HEAD` and [re-review-prompt.md](../re-review-prompt.md).
5. Park residual non-load-bearing findings with rulings. Surface residual load-bearing findings when `finishing-a-development-branch` presents the integration options.

There is no second final-review fix wave.

Completion criterion: the final review is clean or every residual finding has an explicit ruling, and no load-bearing issue is hidden.

## Cleanup

After final review and fixes are complete, remove only this plan's workspace. The git history is the record. Leave sibling plan directories intact, then use `finishing-a-development-branch`.
