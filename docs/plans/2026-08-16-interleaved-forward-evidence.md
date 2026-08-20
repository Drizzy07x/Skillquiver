# Interleaved Forward Evidence Implementation Plan

> **For agentic workers:** Use the host's available task-by-task implementation workflow. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace post-hoc forward evidence with a controller that launches the selected host, interleaves trusted inventory and transaction phases, and publishes only controller-observed evidence.

**Architecture:** A CommonJS controller owns host launch, inventory execution, recovery, filesystem mutation, controls, rollback, event journaling, evidence rendering, and grading. Hosts return schema-valid plans and reports through controller-captured stdout; they cannot author inventories, checkpoints, receipts, host labels, or public evidence.

**Tech Stack:** Node.js 22+ CommonJS and ESM, `node:test`, Node standard-library filesystem/crypto/child-process APIs, Git CLI for fixture setup only, native POSIX permissions, Windows PowerShell ACL APIs, JSON Schema Draft 2020-12 documents, Markdown, and YAML.

## Global Constraints

- The controller-selected host and physical launcher identity are fixed before dispatch; host self-claims never select a namespace or grade.
- Each host owns an independent prepared subject/controller namespace; aggregate grading never reuses a mutated subject across hosts.
- A trusted host adapter must positively attest read-denied controller/recovery paths, a read-only host view, zero writable roots, and stopped process-tree containment before behavioral launch. Missing containment is `unverified`.
- Launch identity is limited to controller-observed pre/post path hashes and argv; do not claim exact executed bytes, vendor signature, or remote model identity.
- No real-host pass may originate from the legacy runnerless `capture` path. Remove `captureEvidence` after migration.
- The controller executes the pinned inspector and preserves exact stdout; workers cannot supply inventory evidence.
- The controller is the sole writer of target files, recovery files, controls, rollback state, events, receipts, rendered reports, and public evidence.
- No target write occurs before complete recovery, privacy verification, and an immediate prewrite recheck.
- APPLY pass 2 uses a fresh host process and must propose zero operations, create no backup, and leave the snapshot unchanged.
- PARTIAL applies the concurrent marker and verifier through controller-private code, excludes the conflicting transaction, and rolls back only the failed project transaction.
- Owner-private backup verification is mandatory. Unsupported or unverifiable privacy blocks mutation.
- Public evidence is generated only after all child processes stop and normalized secret scanning passes.
- One authoritative contract definition drives both hand-written validation and generated Draft 2020-12 schemas; no runtime schema package is added.
- Synthetic tests use real child processes but prove only the controller protocol. Real Codex/Claude claims require controller-launched real executables.
- Controller evidence records pre/post observed executable path hashes, argv,
  and observable effects; it does not prove exact executed bytes, vendor
  signature, or remote model identity.
- Keep exactly three forward tests, one per scenario. Tests never manufacture passing controller evidence.
- Use no npm/runtime dependency. Keep code, tests, comments, documentation, and commits in English.
- Preserve unrelated dirty files. Do not bump versions, release, publish, install, push, or copy authentication.
- Local task-scoped commits are explicitly authorized. Before every commit verify the cached diff; use hunk-only staging whenever a permitted path contains unrelated user changes.
- Run focused tests while iterating. Run `bash tests/run.sh` at most once, only after every implementation/review task is complete.

Externally observable decisions are fixed by the design specification: CLI exit statuses are `0/1/2`; absent safe launchers are `unverified`; launched malformed runs fail; prepare and host execution refuse overwrite/duplicates; dual-host outcomes use fail, blocked, unverified, pass precedence; evidence uses controller-rendered reports and exact controller-captured inventories.

Preflight is distinct from behavioral execution. Missing descriptor/program,
unsafe isolation, or preflight authentication failure is `unverified` and starts
no behavioral run. After an `available-safe` preflight, timeout, nonzero exit,
authentication failure, malformed output, or escaped process tree is `fail`.
An expected PARTIAL `blocked-decision` produces protocol pass plus task outcome
`completed-with-blocked-decision`; operational safety/recovery blocks remain
overall `blocked`.

---

### Task 1: Trusted dispatch and AUDIT protocol

**Files:**
- Create: `benchmarks/improve-agent-instructions/controller.cjs`
- Modify: `benchmarks/improve-agent-instructions/forward.cjs`
- Modify: `tests/improve-agent-instructions-forward.test.cjs`
- Modify: `skills/improve-agent-instructions/scripts/inventory.mjs`
- Modify: `tests/improve-agent-instructions.test.cjs`

**Interfaces:**
- Consumes: existing fixture preparation, `inventory.mjs`, trusted adapter schema v1, independent per-host subject roots, and controller-private fixture expectations.
- Produces: `prepareController`, `readLauncher`, `executeHost`, `runInventory`, `appendEvent`, `sealEvidence`, and `gradeControllerRun` exports from `controller.cjs`.
- Produces delegation from `forward.cjs`: `prepareFixture`, `executeHost`, `recoverHost`, `gradeScenario`, and `runCli`.
- Produces CLI commands `prepare`, `execute`, `recover`, and `grade`; legacy `capture` remains non-authoritative only until Task 3 removes it.
- Produces inventory CLI option `--git-executable ABSOLUTE_PATH`; normal callers may omit it, while the controller always supplies its pinned Git path.
- Produces `CONTRACT_DEFINITIONS`, `validateContract(name, value)`, and `renderPublicSchemas()` from one authoritative definition tree.

- [ ] **Step 1: Add the focused failing AUDIT test**

Rewrite only the AUDIT forward test to launch a real temporary trusted Node
adapter. It completes a sandbox/process preflight, reads phase prompts from
stdin, invokes a contained fake child, and emits canonical schema-v1 adapter
envelopes. Use independent `hosts/codex` and `hosts/claude` subjects.
The test must name and catch these production defects:

1. the controller accepting a host self-claim different from its selected host;
2. the controller accepting any target mutation during AUDIT;
3. the controller accepting adapter-supplied inventory bytes;
4. the controller publishing UTF-16, JSON-escaped, percent, hex, base64, or
   base64url known-private canaries;
5. a missing launcher being treated as pass instead of `unverified`;
6. a launched malformed result becoming `unverified` instead of fail.
7. a preflight that can read controller/recovery canaries, write its host view,
   or leave a descendant being accepted;
8. a second host inheriting the first host's mutated subject;
9. contract definitions and rendered schemas accepting different mutations;
10. ambient/path-selected Git or repository configuration affecting inventory.

Assert controller-created inventory-1/2/3 exact stdout receipts,
pre/post observed adapter/child identity hashes, distinct plan and verify
invocations, process-tree-stop attestations, unchanged target snapshots, a
controller-owned final machine report, six rendered report sections, and the
exact public layout declared in the specification. The test must never create a
passing event, receipt, inventory, final report, or public artifact.

In `tests/improve-agent-instructions.test.cjs`, add one focused inventory case
showing that an explicit absolute Git executable is used and that hostile
ambient Git configuration/hooks/fsmonitor/external diff cannot execute.

- [ ] **Step 2: Verify the relevant RED**

Run: `node --test --test-name-pattern="audit fixture" tests/improve-agent-instructions-forward.test.cjs`

Expected: failure because `controller.cjs`, the `execute` protocol, and
controller-owned evidence do not exist.

- [ ] **Step 3: Implement trusted dispatch and AUDIT**

Implement the minimum design-specification behavior:

- strict argument parsing and `0/1/2` CLI mapping;
- campaign preparation with identical, independent host subjects and a
  read-only aggregate result;
- absolute, outside-campaign trusted adapter validation; `identityFiles` must
  contain adapter and child programs; record pre/post hashes without claiming
  exact executed bytes;
- adapter preflight for sandbox deny/allow canaries, no writable root, declared
  network/tools, authentication availability, and process-tree termination;
- sanitized argv launch with stdin prompt, adapter-specific canonical JSON,
  a declared timeout, and 1 MiB stdout/stderr caps;
- immutable controller-selected host/run/invocation identities;
- two distinct read-only host invocations bracketed by three controller-run
  inventories; controller owns the final report after inventory 3;
- pinned `process.execPath`, Skill bundle, inspector, and absolute Git identity;
  update `inventory.mjs` to use the explicit Git path and sanitized nonexecuting
  Git behavior;
- in-memory canonical predecessor-bound events;
- read-only snapshot bracketing and mutation failure;
- hand-written validation and generated Draft 2020-12 schemas from the same
  definitions, with mutation parity tests;
- controller-rendered final machine/six-section reports;
- normalized known-sensitive scanning and atomic public evidence seal;
- wholly missing/unsafe/unauthenticated preflight `unverified`; any malformed
  behavior after safe preflight fails.

Do not implement APPLY/PARTIAL mutation in this task. Preserve their existing
tests while marking legacy capture results synthetic/non-authoritative.

- [ ] **Step 4: Verify focused GREEN**

Run: `node --test --test-name-pattern="audit fixture" tests/improve-agent-instructions-forward.test.cjs`

Expected: 1 AUDIT test passes and the new attack assertions are exercised.

- [ ] **Step 5: Run affected integration**

Run: `node --test tests/improve-agent-instructions-forward.test.cjs`

Expected: exactly 3 tests pass; APPLY/PARTIAL still pass only as explicitly
synthetic legacy coverage and cannot emit a real-host pass.

- [ ] **Step 6: Commit the deliverable**

```bash
git add benchmarks/improve-agent-instructions/controller.cjs benchmarks/improve-agent-instructions/forward.cjs tests/improve-agent-instructions-forward.test.cjs skills/improve-agent-instructions/scripts/inventory.mjs tests/improve-agent-instructions.test.cjs
git diff --cached --check
git diff --cached --name-only
git commit -m "feat: attest forward audit runs"
```

### Task 2: Controller-owned APPLY transaction

**Files:**
- Modify: `benchmarks/improve-agent-instructions/controller.cjs`
- Modify: `benchmarks/improve-agent-instructions/forward.cjs`
- Modify: `tests/improve-agent-instructions-forward.test.cjs`

**Interfaces:**
- Consumes: Task 1 launcher/inventory/event/schema interfaces; APPLY fixture expected target bytes and transaction membership.
- Produces: `createRecovery`, `verifyRecoveryPrivacy`, `recheckPrewrite`, `applyTransactions`, `runApplyPassTwo`, and `recoverHost` behavior.
- Produces three controller inventories, two physical host invocations, one recovery leaf, and a final controller-rendered APPLY report.

- [ ] **Step 1: Add the focused failing APPLY test**

Rewrite only the APPLY forward test. The real fake adapter emits a pass-1 plan
with proposed base64 target bytes and a separate pass-2 verify result with zero
operations. Test the observable failures:

1. a child mutates a target during planning;
2. recovery or privacy is incomplete before mutation;
3. a preimage, manifest, permission record, or event is corrupted;
4. the second result reuses the first invocation or proposes a write;
5. pass 2 creates a second recovery leaf or changes the pass-1 snapshot;
6. evidence/events are replayed, reordered, or contain an extra artifact.
7. a crash after recovery seal, after the first target write, after a transaction
   commit, or during pass 2 being unrecoverable or non-idempotent;
8. corrupt/missing recovery bytes or an uncertain recorded child causing a
   write instead of `blocked`.

Assert the controller, not the adapter, created byte-exact preimages and target
writes; recovery was sealed and privacy-verified before the first write event;
the two invocation IDs/process captures differ; inventories 2 and 3 normalize
equal; and the final filesystem is the expected idempotent state.

- [ ] **Step 2: Verify the relevant RED**

Run: `node --test --test-name-pattern="apply fixture" tests/improve-agent-instructions-forward.test.cjs`

Expected: failure because controller-owned recovery, writes, and fresh pass-2
execution are missing.

- [ ] **Step 3: Implement APPLY transaction behavior**

- Validate the host plan against the public schema, authorization, exact
  transaction membership, preimage hashes, allowed targets, and representation.
- Create the recovery root outside every repository/target. On POSIX establish
  and verify `0700/0600` plus owner. On Windows use a fixed no-shell PowerShell
  ACL operation to establish and inspect a protected owner DACL; block when the
  filesystem/helper/ACL result is unsafe or unavailable.
- Write all preimages, representation/permission records, manifest, restoration
  state, and an append-only recovery journal; reopen, hash, and privacy-check
  every member before the first target write.
- Recheck every live preimage hash/permission, then apply whole logical
  transactions atomically enough to support complete rollback on failure.
- Run static verification, inventory 2, and a fresh verify-profile host process.
  Reject any pass-2 operation, backup, or snapshot change; capture inventory 3.
- On failure after mutation, stop/confirm child termination and restore the
  affected uncommitted transaction. Implement idempotent `recover` from the
  controller journal; uncertain live child or corrupt recovery returns blocked.
- Exercise the runtime failpoint seam at every persisted/mutation boundary.
  Invoke `recover` in a fresh Node process, invoke it a second time, and assert
  byte-exact state plus idempotent events. The seam may fail a controller phase;
  it may not synthesize recovery success.

- [ ] **Step 4: Verify focused GREEN**

Run: `node --test --test-name-pattern="apply fixture" tests/improve-agent-instructions-forward.test.cjs`

Expected: 1 APPLY test passes with all chronology, privacy, replay, and
idempotence attacks rejected.

- [ ] **Step 5: Run affected integration**

Run: `node --test tests/improve-agent-instructions-forward.test.cjs`

Expected: exactly 3 tests pass; AUDIT and APPLY use controller evidence.

- [ ] **Step 6: Commit the deliverable**

```bash
git add benchmarks/improve-agent-instructions/controller.cjs benchmarks/improve-agent-instructions/forward.cjs tests/improve-agent-instructions-forward.test.cjs
git diff --cached --check
git diff --cached --name-only
git commit -m "feat: control instruction transactions"
```

### Task 3: PARTIAL state machine and legacy removal

**Files:**
- Modify: `benchmarks/improve-agent-instructions/controller.cjs`
- Modify: `benchmarks/improve-agent-instructions/forward.cjs`
- Modify: `tests/improve-agent-instructions-forward.test.cjs`
- Modify: `tests/improve-agent-instructions.test.cjs`
- Modify: `skills/improve-agent-instructions/SKILL.md`

**Interfaces:**
- Consumes: Task 1/2 controller, launcher, inventory, recovery, event, report, and grading interfaces.
- Produces: controller-owned PARTIAL marker/verifier/rollback phases, final public schemas, separate protocol/task outcomes, aggregate dual-host semantics over immutable per-host grades, and the Skill's controller delegation contract.
- Removes: `captureEvidence`, worker-authored checkpoint/receipt/inventory acceptance, and every real-pass claim from runnerless artifacts.

- [ ] **Step 1: Add the focused failing PARTIAL and contract assertions**

Rewrite the PARTIAL forward test to launch a real plan adapter and a real
read-only verify adapter. Test these defects:

1. marker applied before recovery or by worker-controlled code;
2. Claude-global write despite the controller-observed concurrent mismatch;
3. ambiguous nested target changed instead of blocked;
4. verifier outcome claimed rather than controller-executed;
5. incomplete or broad project rollback;
6. control/event reordering, encoded known-private leakage, or extra evidence;
7. legacy `capture` creating a real-host pass.

Add proportional contract assertions to
`tests/improve-agent-instructions.test.cjs` proving the Skill delegates plans
and mutations to an available trusted controller, keeps its normal audit-first
fallback, and reports the controller's honest executable/coverage/privacy
limits.

- [ ] **Step 2: Verify the relevant RED**

Run: `node --test --test-name-pattern="partial fixture|controller" tests/improve-agent-instructions-forward.test.cjs tests/improve-agent-instructions.test.cjs`

Expected: failure because PARTIAL is still legacy and the Skill lacks the
trusted-controller delegation contract.

- [ ] **Step 3: Implement PARTIAL and remove legacy evidence**

- Validate the plan's safe transactions and explicit blocked ambiguity.
- Create/verify complete recovery, then apply the concurrent marker through a
  controller-private function and record its before/after snapshot.
- Recheck every target. Exclude Claude-global on mismatch, apply Codex-global
  and the project pair as independent transactions, then execute the private
  verifier.
- On verifier failure roll back only the project pair byte-for-byte, rerun the
  verifier, and retain the safe Codex change plus concurrent Claude content.
- Run inventories 2/3 around the final read-only host invocation and require no
  target mutation.
- Validate the host machine report against controller facts; render six Markdown
  sections from the controller-owned final report after inventory 3; scan every
  staged public artifact; atomically seal evidence.
- Record `protocolOutcome: pass` plus
  `taskOutcome: completed-with-blocked-decision` when the only blocked item is
  the expected ambiguous target. Reserve overall `blocked` for operational or
  safety failure.
- Remove `captureEvidence`, post-hoc worker evidence schemas, and legacy real
  grade paths. Keep exactly three controller-based forward tests.
- Update `SKILL.md`: when the caller provides a trusted controller, the Skill
  returns schema-valid plans/reports and never bypasses controller-owned side
  effects; without a controller, retain the approved normal transaction flow
  and label runtime provenance limits honestly.

- [ ] **Step 4: Verify focused GREEN**

Run: `node --test --test-name-pattern="partial fixture|controller" tests/improve-agent-instructions-forward.test.cjs tests/improve-agent-instructions.test.cjs`

Expected: the PARTIAL scenario and controller-contract assertions pass.

- [ ] **Step 5: Run affected integration**

Run: `node --test tests/improve-agent-instructions.test.cjs tests/improve-agent-instructions-forward.test.cjs tests/catalog.test.cjs`

Expected: all affected tests pass; the forward file contains exactly three
tests and no runnerless path can produce a real-host pass.

- [ ] **Step 6: Commit the deliverable**

```bash
git add benchmarks/improve-agent-instructions/controller.cjs benchmarks/improve-agent-instructions/forward.cjs tests/improve-agent-instructions-forward.test.cjs tests/improve-agent-instructions.test.cjs skills/improve-agent-instructions/SKILL.md
git diff --cached --check
git diff --cached --name-only
git commit -m "feat: enforce forward phase control"
```

### Task 4: Native host adapters and real execution

**Files:**
- Create: `benchmarks/improve-agent-instructions/host-adapter.cjs`
- Modify: `tests/improve-agent-instructions-forward.test.cjs`
- Modify only when a focused adapter defect requires it: `benchmarks/improve-agent-instructions/controller.cjs`
- Preserve without staging: unrelated candidate-release files and task SDD artifacts

**Interfaces:**
- Consumes: final controller CLI, caller-approved native Codex/Claude executable paths, adapter contract/schemas, and platform containment/privacy adapters.
- Produces: `runAdapter(profile, prompt, launcher, runtime?)` and CLI behavior in `host-adapter.cjs`, plus real controller evidence per safely available host.

- [ ] **Step 1: Add focused adapter RED cases**

Inside the existing three forward tests, add subcases that execute
`host-adapter.cjs` against temporary native-CLI fixtures:

- Codex-like JSONL plus controller-owned final-result file must normalize to the
  canonical envelope; wrong schema, escaped process tree, failed deny-canary,
  or authentication-preflight failure cannot become a behavioral pass.
- Claude-like `--output-format json` envelope with structured output must
  normalize identically; free text, missing structured output, enabled tools,
  or a failed containment probe is rejected.
- Preflight statuses `missing`, `unsafe`, and `unauthenticated` map to
  `unverified` without a plan/verify launch; the same errors after
  `available-safe` map to fail.

Run: `node --test tests/improve-agent-instructions-forward.test.cjs`

Expected: RED because `host-adapter.cjs` does not exist.

- [ ] **Step 2: Implement trusted native adapter profiles**

Implement the trusted native adapter profiles:

- Codex: stdin prompt, `codex exec --ephemeral --ignore-user-config
  --ignore-rules --output-schema --sandbox read-only`, controller-owned result
  path/JSONL parsing, read-only host view, and adapter preflight;
- Claude: stdin prompt, `claude --print --output-format json --json-schema
  --no-session-persistence --tools ""`, controller-owned JSON-envelope
  parsing, read-only host view, and adapter preflight.

The platform containment adapter must positively test an allowed host-view
read, denied controller/recovery reads, denied write, and no remaining process
tree under the identical launch policy. On POSIX use a dedicated process group
and require it empty after termination. On Windows enumerate the recorded PID
tree through a fixed PowerShell/CIM JSON helper, terminate any descendant, and
return `unsafe` unless the tree is empty. Native host sandbox/tool denial must
prevent private-path access while the child is live; post-exit detection alone
is insufficient.

The adapter inherits only explicitly named authentication entries into the
native child and records names/digests, never values. Resolve each executable,
record pre/post path/hash/version observations, enforce the descriptor timeout
and byte caps, and output one canonical envelope.

- [ ] **Step 3: Verify adapter GREEN and affected integration**

Run:

```text
node --test tests/improve-agent-instructions-forward.test.cjs
node --test tests/improve-agent-instructions.test.cjs tests/improve-agent-instructions-forward.test.cjs tests/catalog.test.cjs
```

Expected: exactly three forward tests and all affected integration tests pass.

- [ ] **Step 4: Commit native adapters**

```bash
git add benchmarks/improve-agent-instructions/host-adapter.cjs benchmarks/improve-agent-instructions/controller.cjs tests/improve-agent-instructions-forward.test.cjs
git diff --cached --check
git diff --cached --name-only
git commit -m "feat: adapt instruction hosts"
```

- [ ] **Step 5: Run controller-backed real scenarios sequentially**

Resolve each executable and run one bounded preflight plus AUDIT smoke. Missing
executable, failed authentication preflight, or unavailable filesystem/process
containment remains `unverified`; do not launch the behavioral matrix,
fabricate evidence, or repeat the same failed probe.

For each scenario, create one fresh campaign, execute every safely available
host in that campaign's independent host namespace, and then aggregate-grade
the immutable per-host results. Inspect
controller events, launcher identities, raw-output hashes, exact target diffs,
recovery privacy, report consistency, and grades. Process exit zero without a
semantic pass is failure. Overall dual-host behavior remains `unverified` when
one host is unavailable.

No real execution result is committed. Record exact paths/hashes/grades in the
task report outside Git.

### Task 5: Package and final completion gates

**Files:**
- Modify exact `.mjs` portability hunks only: `benchmarks/build-codex-package.cjs`
- Modify exact `.mjs` packaging assertions only: `tests/codex-package.test.cjs`
- Preserve without staging: unrelated candidate-release files and task SDD artifacts

**Interfaces:**
- Consumes: reviewed controller/adapter/Skill, existing `inventory.mjs`, package builder, quick validator, plugin evaluator, and Task 4 real-host report.
- Produces: portable packaged inspector proof, static Skill validation, one final full-suite result, and one local package commit. No push/release/install.

- [ ] **Step 1: Verify packaging and Skill structure**

Run focused package tests after staging only the `.mjs` extension/packaged
inspector hunks. Run the generic Skill validator and plugin static analyzer from
their existing local paths; do not install dependencies or publish artifacts.

Focused commands:

```text
node --test tests/codex-package.test.cjs
node --test tests/improve-agent-instructions.test.cjs tests/improve-agent-instructions-forward.test.cjs tests/catalog.test.cjs tests/codex-package.test.cjs
python <skill-creator>/scripts/quick_validate.py skills/improve-agent-instructions
node <plugin-eval>/scripts/plugin-eval.js analyze skills/improve-agent-instructions --format json
```

- [ ] **Step 2: Run the full suite exactly once**

Run: `C:\Program Files\Git\bin\bash.exe tests/run.sh`

Expected: the complete suite exits zero. If a later code fix is required, run
only its focused tests and report that the full-suite result predates the fix;
do not rerun the full suite.

- [ ] **Step 3: Audit and commit only package portability hunks**

Run `git diff --check`, inspect the staged diff, and confirm candidate-release
hunks remain unstaged. Commit only the `.mjs` packaging changes:

```bash
git add -p benchmarks/build-codex-package.cjs tests/codex-package.test.cjs
git diff --cached --check
git diff --cached
git commit -m "fix: package instruction inspector"
```

No version bump, release, installation, push, publication, or authentication
copy is authorized.

## Unresolved product decisions

None. The user explicitly authorized the controller-interleaved redesign and
local task-scoped commits. The protocol's honest identity limits, trusted
adapter/isolation boundary, per-host subjects, preflight/authentication status,
controller-owned report, schema-validation strategy, privacy predicates,
status precedence, normal controller delegation, and real-host evidence
boundary are fixed above.
