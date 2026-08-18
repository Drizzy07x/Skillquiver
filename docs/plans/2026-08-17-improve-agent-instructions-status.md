# Improve Agent Instructions — WIP Status

Date: 2026-08-17

This file preserves the implementation state for the two approved plans:

- `docs/plans/2026-08-16-improve-agent-instructions-automation.md`
- `docs/plans/2026-08-16-interleaved-forward-evidence.md`

The Skill is **not complete**. This branch is a recoverable work-in-progress
checkpoint, not release evidence.

## Completed foundation

- The `improve-agent-instructions` Skill, catalog metadata, package integration,
  read-only inventory inspector, and focused inventory tests exist.
- AUDIT has controller-owned preparation, inventory execution, host namespaces,
  evidence schemas, sanitized launching, report rendering, and grading.
- Prior focused checks established pinned Git behavior, three forward scenario
  entry points, schema parity, secret scanning, and controller-owned evidence.

## Current AUDIT gate

The current worktree contains the round-4 semantic-provenance and trusted
synthetic-containment redesign. General host recommendations are separated from
controller-proved observations. Child-controlled fd/PID tracking is being
replaced by a trusted synthetic launch seam.

The latest focused command was:

```text
node --test --test-name-pattern="audit fixture" tests/improve-agent-instructions-forward.test.cjs
```

Latest result: exit `1`, tests `0/1`, duration `5145.7368 ms`. The first failing
assertion was the stale inventory-launch counter at
`tests/improve-agent-instructions-forward.test.cjs:1595`:
`runtimeCalls.spawn >= 6` was false after adapter launches moved to the trusted
synthetic seam. The failure occurs before the result and containment assertions,
so the redesigned containment behavior is not yet verified. Two permitted fix
attempts were consumed; no third attempt was run.

No full suite or real Codex/Claude host was run for this WIP state.

## Remaining implementation sequence

1. Finish the AUDIT containment gate, close the native-launch/environment
   boundary, obtain focused GREEN, and pass a fresh independent review.
2. Implement controller-owned APPLY transactions with owner-private recovery,
   prewrite rechecks, rollback, and a fresh idempotent second pass.
3. Implement PARTIAL decision handling and transaction-scoped rollback; remove
   the legacy capture path.
4. Implement real Codex and Claude adapters with platform containment and honest
   unavailable-host reporting.
5. Run package validation, the single final full suite, representative real-host
   checks where available, and a requirement-by-requirement completion audit.

## Resume boundary

Resume from the current branch without resetting the worktree. Preserve the
round-4 controller and forward-test changes. Before another focused AUDIT run,
review whether the obsolete `runtimeCalls.spawn` assertion should count only the
three controller-owned inventory executions per host or be replaced by a direct
inventory-invocation receipt assertion. Do not label the Skill ready until every
remaining step above is complete and verified.
