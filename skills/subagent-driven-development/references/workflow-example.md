# Workflow Calibration

Read this reference when calibrating the controller, diagnosing a stalled loop, or checking the intended end-to-end sequence.

## Common Failure Modes

| Rationalization | Required response |
|---|---|
| “Close enough on spec compliance” | Fix the gap or reach the cap and adjudicate it. |
| “I will fix it in the controller” | Resume or replace the implementer so the fix receives review. |
| “One more round will converge” | Stop at five rounds and adjudicate. |
| “The reviewer may find something new” | Keep re-review scoped; ledger untouched-code observations. |
| “This finding is obviously wrong” | Adjudicate only at the cap and record the ruling. |
| “The fix is small enough to skip review” | Every fix round ends with a scoped re-review. |
| “Reviews slow the loop” | Treat review as the gate that makes iteration trustworthy. |
| “Ledger bookkeeping is overhead” | Treat the ledger as the recovery source after compaction. |

## Example Workflow

```text
Controller: use Subagent-Driven Development for the plan.

[Verify isolated workspace]
[Read the plan once]
[Resolve scripts/sdd-workspace PLAN_FILE]
[Create or resume the plan-owned ledger]
[Scan the plan for contradictions]

Task 1
[Record BASE]
[Generate task brief]
[Dispatch implementer with brief and report paths]

Implementer: DONE; committed; focused and final tests pass; report written.

[Generate review package BASE..HEAD]
[Dispatch task reviewer with brief, report, package, and global constraints]

Reviewer: spec compliant; task quality approved.

[Ledger: Task 1 complete with commit range]

Task 2
[Repeat implementation]

Reviewer: spec gap and one Important finding.

[Fix round 1: resume implementer with both findings]
[Implementer appends fix and test evidence]
[Generate scoped FIX_BASE..HEAD review package]
[Dispatch re-reviewer]

Re-reviewer: both findings addressed; no new breakage.

[Ledger fix round and task completion]

[After every task: generate MERGE_BASE..HEAD review package]
[Dispatch final whole-branch reviewer]
[Resolve one final fix wave if needed]
[Remove only this plan's workspace]
[Use finishing-a-development-branch]
```

The sequence is complete when every task has a ledger completion line, the final review has no unruled findings, and cleanup targets only the active plan's workspace.
