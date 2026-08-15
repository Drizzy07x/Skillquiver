---
name: subagent-driven-development
description: Executes an implementation plan by dispatching one subagent per task with per-task review gates, keeping the orchestrator's context small. Use when executing plans with independent tasks in the current session.
---

# Subagent-Driven Development

Execute a plan with one fresh implementer per task, a task-scoped review after each implementation, and one whole-branch review at the end.

This workflow requires isolated worker dispatch. If the host cannot dispatch subagents, use `executing-plans` instead.

**Core principle:** Fresh implementer + spec and quality review + scoped fixes + final review.

**Narration:** Between tool calls, use at most one short line. The ledger and tool results carry the durable record.

**Continuous execution:** Run every task without asking whether to continue. Stop only for an unresolved blocker, ambiguity that prevents safe progress, or completed work.

## When to Use

Use this workflow when all are true:

- A decision-complete implementation plan exists.
- Tasks are independent enough for one implementer at a time.
- Work stays in the current session.
- The host supports isolated workers.

Use `executing-plans` for a parallel session. Return to planning when tasks are tightly coupled or the plan is incomplete.

## Setup

1. Verify an isolated workspace with `using-git-worktrees`. Work on `main` or `master` only with explicit user consent.
2. Invoke this skill's scripts through Bash on every platform because packaging may not preserve executable bits. On Windows, use Git Bash.
3. Resolve the plan workspace:

   ```bash
   bash <skill-dir>/scripts/sdd-workspace PLAN_FILE
   ```

   The command prints `<repo-root>/.skillquiver/sdd/<plan-basename>-<path-hash>/`. This git-ignored directory owns every artifact for this plan: ledger, briefs, reports, and review packages. Never reuse another plan's directory.
4. Inspect `<workspace>/progress.md`:
   - If its first line names this plan, treat every `Task <N>: complete` line as authoritative and resume at the first incomplete task.
   - If a task ends with a fix-round entry, resume at the next round.
   - If the ledger names another plan, or exists at the obsolete `.superpowers/sdd/progress.md`, leave it intact and create this plan's ledger.
5. Create a missing ledger with `# SDD ledger — plan: <plan file path>` as its first line.
6. Read the plan once, record its context and Global Constraints, and create one todo per task.
7. Before Task 1, scan the complete plan for contradictions between tasks, Global Constraints, and the review rubric. Present all conflicts in one batched question beside the binding plan text. Proceed immediately when the scan is clean.

The ledger is the recovery map after compaction. Trust it and `git log` over conversation memory. `git clean -fdx` destroys this scratch workspace; recover task state from git history if that happens.

Completion criterion: the workspace belongs to the active plan, its ledger identity is correct, completed tasks are not re-dispatched, and every plan conflict is resolved before implementation.

## Before the First Dispatch

Read [dispatch-and-model-selection.md](references/dispatch-and-model-selection.md) before dispatching the first worker. Re-read its model-selection section whenever the role or task complexity changes.

Worker context is constructed, not inherited. Pass only the task's requirements, relevant interfaces, constraints, and artifact paths. Every pasted prompt and worker response remains in controller context; hand large artifacts over as files.

## Task Loop

Run these steps sequentially for each incomplete task. Never dispatch implementation workers in parallel.

### 1. Dispatch the Implementer

1. Record `BASE` with `git rev-parse HEAD`.
2. Generate the task brief:

   ```bash
   bash <skill-dir>/scripts/task-brief PLAN_FILE N
   ```

3. Derive the report path from the brief: `task-N-brief.md` becomes `task-N-report.md` in the same workspace.
4. Compose one task dispatch containing:
   - One line explaining where the task fits.
   - The brief path introduced as the requirements and source of exact values.
   - Interfaces and decisions from earlier tasks that the brief cannot know.
   - Any resolved ambiguity.
   - A pointer to each parked ledger finding in an area this task touches.
   - The report path and short return contract.
5. Keep exact values, signatures, and test cases in the brief. Do not paste accumulated task history or send the whole plan.
6. Dispatch with [implementer-prompt.md](implementer-prompt.md) using the host mapping and model selected from the dispatch reference.
7. Record the worker identity so fix rounds 1–3 can resume it.

Completion criterion: the worker has isolated context, one task brief, one report path, the necessary prior interfaces, and no unrelated history.

### 2. Handle the Implementer Status

- `DONE`: generate the review package and continue to task review.
- `DONE_WITH_CONCERNS`: read the concerns. Resolve correctness or scope doubts before review; ledger observations and continue.
- `NEEDS_CONTEXT`: provide the missing information and resume the same worker.
- `BLOCKED`: change the conditions before retrying—supply missing context, choose a more capable model, split an oversized task, or escalate a defective plan to the user.

Answer worker questions completely. Never repeat an unchanged dispatch after a worker reports that it is stuck.

Completion criterion: implementation is complete with a report and commit range, or the task has an explicit unresolved blocker.

### 3. Review the Task

Before the first task review, read [review-and-fix-loop.md](references/review-and-fix-loop.md) through “Complete the Task.” Follow it for every review, finding, fix round, re-review, ledger entry, and breaker decision.

Generate the initial package with the `BASE` captured before implementation:

```bash
bash <skill-dir>/scripts/review-package PLAN_FILE BASE HEAD
```

Dispatch [task-reviewer-prompt.md](task-reviewer-prompt.md) with the printed package path, task brief, implementer report, and binding Global Constraints.

- Clean spec and quality verdicts: record task completion.
- Spec gap, Critical or Important finding, or confirmed `⚠️` gap: enter the referenced fix loop.
- Minor finding: defer it in the ledger for final review.
- Finding that conflicts with binding plan text: ask the user which governs.

Completion criterion: the ledger contains a task completion line and no Critical or Important finding remains open without a ruling at the five-round cap.

### 4. Continue

Mark the task todo complete and move directly to the next incomplete task. The task review is the gate; controller self-review never replaces it.

## Final Review and Finish

After every task has a completion line, read “Final Whole-Branch Review” and “Cleanup” in [review-and-fix-loop.md](references/review-and-fix-loop.md).

Generate the final review package over `MERGE_BASE..HEAD`, dispatch the most capable available reviewer, resolve at most one final fix wave, and record a ruling for every residual finding. Then remove only this plan's workspace and use `finishing-a-development-branch`.

Completion criterion: every task is complete in the ledger, the final review is clean or all residual findings have rulings, no load-bearing issue is hidden, and only the active plan's workspace is removed.

## Calibration

When the controller stalls, rationalizes skipping a gate, or needs an end-to-end example, read [workflow-example.md](references/workflow-example.md).
