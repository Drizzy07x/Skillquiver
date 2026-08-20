# Improve Agent Instructions — WIP Status

Date: 2026-08-19

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

## AUDIT gate: closed

The round-4 semantic-provenance and trusted synthetic-containment redesign is
complete and verified. `bash tests/run.sh` passes: 81/81 Node tests, the bash
script suites, and the benchmark wrapper. Windows release tool tests still skip
when `pwsh.exe` is unavailable.

Three defects closed the gate.

**Unsatisfiable containment equality.** `validateStoppedProcess` required the
adapter's self-reported `observedPids` to equal the trusted runtime's observed
set. Windows attaches a `conhost.exe` console host to every console process, so
the runtime always observes processes the adapter cannot enumerate; the
equality could never hold. The contract is now directional: the adapter may only
claim processes the runtime observed (rejects fabricated process evidence), and
it must account for every process the runtime *attributed* to it (rejects an
omitted descendant). Attribution is decided by full image path, so an adapter
cannot evade it by naming a descendant `conhost.exe`.

**A leaked global.** `sanitizeInvocation` carried a bare `process` shorthand
that resolved to Node's global object, serializing `process.env`, `argv`, and
the loaded module graph into the public `result.json`. The privacy scanner did
not catch it because it matches declared canaries, not environment contents.
The field had no consumer and `containment` plus `processTreeStopped` already
carry the process evidence, so it was removed.

**Sampled containment could not prove containment.** The trusted supervisor
sampled the process table every 25 ms, but a Windows sample costs ~300 ms
through `Get-CimInstance Win32_Process`. A descendant that spawned and detached
inside that window escaped observation entirely, so the behavioral survivor
scenario passed a live process back to the host. The supervisor is now native:
`benchmarks/containment-supervisor` creates the adapter suspended, assigns it to
a job object before it executes an instruction, and resumes it. Job membership
is authoritative rather than sampled, and `TerminateJobObject` stops the whole
tree regardless of parentage or detachment. Linux keeps the `/proc` reader,
where sampling is three orders of magnitude cheaper and remains sound.

The native supervisor publishes self-contained because the harness launches it
under a sanitized environment where a framework-dependent host cannot resolve a
shared runtime. Windows runs therefore need the .NET SDK; the test builds the
executable on demand into the gitignored `benchmarks/bin/`, or
`benchmarks/build-containment-supervisor.ps1` builds it ahead of time. CI is
unaffected: it runs on Linux and never reaches this path.

## Remaining implementation sequence

1. Implement controller-owned APPLY transactions with owner-private recovery,
   prewrite rechecks, rollback, and a fresh idempotent second pass.
2. Implement PARTIAL decision handling and transaction-scoped rollback; remove
   the legacy capture path.
3. Implement real Codex and Claude adapters with platform containment and honest
   unavailable-host reporting. The job-object supervisor is the Windows
   containment seam these adapters should reuse.
4. Run package validation, the single final full suite, representative real-host
   checks where available, and a requirement-by-requirement completion audit.

## Resume boundary

The AUDIT work is uncommitted in the working tree. No real Codex or Claude host
has been exercised; every AUDIT result to date is synthetic-provenance evidence
and none of it is a release claim. Do not label the Skill ready until every
remaining step above is complete and verified.
