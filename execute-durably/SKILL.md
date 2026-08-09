---
name: execute-durably
description: Run long, multi-turn, or interruption-prone work against an external state file with falsifiable criteria, an append-only evidence log, and independent verification before any criterion closes. Use when work spans several turns, risks context compaction, or must survive interruption and resume from where it stopped; skip work that finishes and can be checked in a single pass.
---

# Execute Durably

Use durable state only when its recovery value exceeds its overhead. Keep state outside the repository so the project never acquires workflow artifacts.

## 1. Initialize the state file

Create one state file per session (markdown or JSON) in a scratch directory or user-level location outside the repo. It holds:

- **Objective**: the complete outcome, stated once.
- **Criteria**: numbered and falsifiable. Each names the exact command or observation that proves it and what failure would look like. A criterion you cannot fail is not a criterion.
- **Per-criterion status**: `pending -> in_progress -> claimed -> verified`. Side exits: `failed`, `rejected`, `stale` — each reopens to `pending` with a written reason, never silently.
- **Evidence log**: append-only. Never rewrite or delete an entry; correct by appending a new one.

Order criteria tracer-first: the first criterion proves a thin end-to-end slice through every layer involved. Thicken behind proven wiring; do not perfect one layer while its connection to the next is a guess.

Evidence is bound to the source it was captured against. Any later source change makes prior evidence stale: rerun the check and re-verify before closing.

## 2. Resume from state, not memory

At the start of every later turn — and always after compaction or interruption — reread the state file before acting. Continue the first unresolved criterion. Do not rebuild the plan from memory; when memory and state disagree, state wins. The log, not recollection, says what has been proven.

## 3. Record evidence verbatim

Append one log entry per check:

- **Executable check**: exact command, exit code, and the decisive output lines copied verbatim. Paraphrased output is not evidence. Only a zero exit code is eligible to support a claim.
- **Visual, web, or desktop check**: screenshot or artifact path plus one line stating what it shows. Capture such evidence with automate-ui; it supports a behavioral criterion only alongside the executable check, and stays `claimed` until verified.
- **Navigation or research findings**: record why files, tests, or sources were selected — but discovery evidence never completes a behavioral criterion by itself.

A successful check makes a criterion `claimed`, never `verified`.

**Red/green for any bug fix or regression test:**

1. Run the test before touching source and log the failing run: command, nonzero exit, failure lines. A test that already passes, a syntax error, a broken fixture, or invented output is not red.
2. Change the source only after red is on record.
3. Rerun the *identical* command and log the passing run. A changed command or unchanged source voids the cycle.

**Upstream-bug claims**: before blaming a framework, library, or host, rule out this project's own code. The claim requires a minimal reproduction outside the project, logged as evidence like any other.

## 4. Delegate with work packets (medium or large work only)

For implementation that splits into independent file sets, write one dependency-aware packet plan before starting workers. Do not use packets for a focused edit. Each packet declares:

- **id, objective, owned paths** — one owner per file set; no ownership overlap between packets; coupled edits stay under one owner rather than being forced apart.
- **dependencies** — no cycles; start a packet only after its dependencies complete.
- **invariants, checks** (exact commands), **integration notes**.

A packet completes only when its declared checks pass against its current owned files. Later changes inside a completed packet's ownership invalidate it: reopen it and its dependents, rerun checks in dependency order. Packet checks are scoped implementation gates; they never replace integrated criteria or independent verification. Completing the last packet leaves the session open — run the integrated criterion checks and verify them independently.

**Delegation contract** (fresh subagents; applies with or without packets): every assignment names the deliverable, minimum context, owned paths, permissions, executable check, and stop conditions. Every worker reports status, changed paths, commands actually run with exit codes, blockers, and remaining risks — missing fields are an invalid result, not implied success. Workers modify only owned paths and never verify work they touched. Give an investigator a question, not a remedy; a diagnosis that arrives pre-committed to a fix is the failure this exists to prevent. A researcher binds every finding to its source and version, and reports disagreeing sources as disagreement. A reviewer returns findings against a named standard, never a completion verdict; "nothing found" is valid, a manufactured minor finding is not. Split test writer from executor only when their edits cannot overlap; otherwise one executor keeps both and preserves the red/green record. Allow at most one classified retry per delegated unit, and re-evaluate the plan after each wave.

## 5. Verify independently

Before any criterion moves `claimed -> verified`, a fresh subagent or second independent context inspects: the objective, the relevant diff, the criterion, and its evidence entries — without being told the expected verdict. Verdicts are `confirmed`, `rejected`, or `inconclusive`; only `confirmed` closes.

- Self-verification never closes a criterion.
- A different name without a fresh context is not independence; the verifier must not have seen the desired conclusion.
- The verifier is read-only and distinct from everyone whose work it reviews.
- Verification against stale evidence is invalid: rerun first.

## Execution discipline

Rules that hold across every criterion, checkable against the diff and the log:

- **One authority per fact.** Before adding a constant, format, or rule, find its existing owner. Two authorities for one fact is itself a finding; a third blocks completion until one owner remains.
- **One concern per diff.** A diff serves the concern its criterion names. Unrelated edits split out or revert; coupled edits stay under one owner.
- **Crash early.** An impossible state raises a domain error at the point of detection, naming the failing thing. Code that limps past a detected impossibility fails review even with passing tests.
- **Suspect this repository first** — see section 3's upstream-bug rule.
- **Tracer first** — see section 1's criterion ordering.

## 6. Close only through the gate

Complete the session only when every criterion is `verified` and no evidence is stale. Any pending, failed, blocked, rejected, inconclusive, or stale criterion blocks completion — there is no retry-limit or fail-open escape. Do not create commits, branches, PRs, security reviews, or publications unless the user asked for them.

## Pause points

DO-CONFIRM: work from judgment, then stop at each point and confirm every item. An unconfirmed item goes in the report, never silently past it.

**Before the first evidence entry**
- Criteria are falsifiable and ordered so the first proves end-to-end wiring.
- State file lives outside the repository; resume reads state, not memory.

**Before each criterion closes**
- Evidence shows the real command, exit code, and verbatim decisive output.
- The diff serves one concern and introduced no second authority for any fact.
- A different, fresh verifier confirmed the evidence without a suggested verdict.

**Before completing the session**
- Every criterion verified; none pending, stale, or inconclusive.
- Upstream-bug claims carry an out-of-project reproduction.
- No commit, branch, or publication happened without an explicit request.

## Boundaries

This skill governs durability and proof, not the work itself. Debugging method belongs to diagnose-systematically; safe restructuring to refactor-safely; auditing a finished delivery claim to verify-work; web and desktop evidence capture to automate-ui; version-bound documentation lookup to research-systematically.
