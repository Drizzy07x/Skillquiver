# Interleaved Forward Evidence Design

Date: 2026-08-16
Status: Approved by the user for implementation
Supersedes: the runnerless forward-evidence design in the original automation
specification and plan

## Problem

The current forward harness accepts worker-authored inventories, checkpoints,
host labels, reports, and recovery records after a scenario has finished. Hash
chains prove that those files agree with one another, but cannot prove which
host ran or when inventory, backup, writes, verification, and rollback occurred.
An internally consistent post-hoc bundle can therefore pass.

The user authorized replacing that design with a controller-interleaved
protocol. The controller must launch the selected host, observe each phase, own
all evidence, and perform every safety-critical filesystem operation.

## Goals

- Prove that the controller launched a caller-approved executable for a named
  Codex or Claude run.
- Prove phase ordering from controller observations rather than worker claims.
- Execute the pinned inventory inspector and preserve its exact stdout.
- Create and verify complete recovery material before the first target write.
- Keep all target mutation, concurrent controls, verification, and rollback in
  the controller.
- Require a second fresh host invocation to prove APPLY idempotence.
- Publish only controller-generated, schema-valid, secret-scanned evidence.
- Keep absent or unsafe hosts `unverified`; fail any launched but incomplete or
  malformed run.
- Work on Windows, macOS, Linux, and WSL without shell interpolation.

## Non-goals and honest limits

- The protocol proves the controller-observed launcher/child paths, arguments,
  and pre/post-launch identity hashes. Portable path-based process launch cannot
  prove the exact bytes opened by the OS, interpreter/DLL identity, vendor
  signatures, remote model identity, or provider-side execution.
- Owner-private permissions protect backups from other principals. They do not
  hide files from a deliberately malicious process running as the same OS user.
- The scanner proves nondisclosure of seeded canaries and known private fixture
  bodies in declared reversible encodings. It does not prove that arbitrary
  unknown secrets are absent.
- A real arbitrary host inventory may have partial coverage because of
  inaccessible, approval-gated, managed, or undocumented sources. Only the
  closed fixture inventory can be asserted complete.
- Synthetic launcher tests prove the controller protocol, not real Codex or
  Claude behavior. Real-host claims require the controller to launch the real
  configured executable.

## Trust boundary

Trusted:

- the controller bytes and in-memory state;
- the pinned `inventory.mjs` bytes checked before every execution;
- controller-private fixture expectations, controls, recovery logic, schemas,
  and event generation;
- the caller-selected, controller-owned host adapter and launcher configuration
  read once before dispatch;
- a platform isolation adapter that positively attests the required filesystem
  and process-tree policy.

Untrusted:

- host stdout and stderr;
- host-proposed edits, decisions, and reports;
- every file beneath the subject tree;
- repository Git configuration, hooks, attributes, shims, and instruction
  content;
- host self-reported identity, timestamps, checkpoints, hashes, or receipts.

The controller never ingests a worker-created receipt, checkpoint, inventory,
or evidence directory. The selected host name is a controller argument and
cannot be changed by host output.

### Required host isolation

Every behavioral invocation runs in a per-host read-only view that contains
only the public request, validated inventory, schema, and instruction inputs
needed for that phase. The host cannot see the live subject, controller state,
recovery tree, evidence staging tree, sibling host, ambient home, or
authentication files through filesystem tools. It receives no writable path.

A trusted adapter must complete an active preflight before any behavioral
invocation. Its structured attestation proves that the same sandbox profile:

- allows reads only from the host view and fixed Skill inputs;
- denies reads of controller/recovery/evidence canaries;
- denies all filesystem writes;
- applies the declared network and tool policy;
- contains the complete child process tree and can prove it stopped.

The controller never creates recovery material or mutates a target while a
host process tree is live. If isolation or process-tree termination cannot be
positively attested on the current platform, that host is `unverified` and no
behavioral invocation starts. Detection after an unrestricted launch is not a
substitute for prevention.

## Interfaces

### CLI

```text
node forward.cjs prepare <audit|apply|partial> <campaign-root>
node forward.cjs execute <scenario> <campaign-root> --host <codex|claude> --launcher <absolute-launcher.json>
node forward.cjs recover <scenario> <campaign-root> --host <codex|claude>
node forward.cjs grade <scenario> <campaign-root>
```

Exit statuses:

- `0`: the command completed and emitted its JSON result. `execute` may return
  an `unverified` host result when the launcher is absent or cannot be used
  safely.
- `1`: an operational, semantic, protocol, privacy, or recovery failure.
- `2`: invalid CLI usage; no result JSON is emitted.

`prepare` refuses an existing campaign state and creates independent, identical
`hosts/codex` and `hosts/claude` subject/controller namespaces. `execute`
operates only the selected namespace and refuses a duplicate host result.
`recover` is idempotent only after it can prove that no recorded host process
remains active. `grade` never repairs state and aggregates immutable per-host
grades without sharing mutable subject state.

### CommonJS exports

```js
prepareFixture(scenarioId, runRoot)
executeHost(scenarioId, runRoot, { host, launcherPath }, runtime?)
recoverHost(scenarioId, runRoot, host, runtime?)
gradeScenario(scenarioId, runRoot)
runCli(argv, io, runtime?)
```

`runtime` is an explicit dependency seam for clocks, process launching, and
platform permission adapters. Production defaults remain Node/OS-native. Tests
use real child processes and real temporary files; they may replace only an OS
boundary that the current platform cannot exercise safely.

### Trusted adapter schema

The launcher is caller-owned and must be outside the campaign tree. It names a
trusted adapter that normalizes native host output and enforces isolation. The
controller resolves and reads it once before dispatch.

```json
{
  "schemaVersion": 1,
  "host": "codex",
  "adapterKind": "trusted-host-adapter-v1",
  "adapterProgram": "C:/absolute/controller-owned-adapter",
  "hostProgram": "C:/absolute/codex-or-claude",
  "identityFiles": [
    "C:/absolute/controller-owned-adapter",
    "C:/absolute/codex-or-claude"
  ],
  "environmentNames": ["CODEX_HOME"],
  "isolationProfile": "read-only-host-view-v1",
  "profiles": {
    "preflight": {
      "args": [],
      "promptTransport": "stdin",
      "resultTransport": "adapter-json"
    },
    "plan": {
      "args": [],
      "promptTransport": "stdin",
      "resultTransport": "adapter-json"
    },
    "verify": {
      "args": [],
      "promptTransport": "stdin",
      "resultTransport": "adapter-json"
    }
  },
  "timeoutMs": 600000,
  "maxStdoutBytes": 1048576,
  "maxStderrBytes": 1048576
}
```

All paths are absolute regular files outside the campaign. `identityFiles`
must contain both programs. Every identity file is opened, read, hashed, and
re-statted before and after launch. The record is named
`controller-observed-launch-identity`; it is not exact executed-byte or vendor
attestation.

The adapter launches the native child with host-specific parsing:

- `codex-cli-v1`: stdin prompt, Codex output schema, and controller-owned final
  result path/JSONL parser;
- `claude-cli-v1`: stdin prompt, `--print`, JSON schema, and Claude JSON envelope
  parser;
- `synthetic-v1`: test-only adapter that can never emit a real-host claim.

The adapter receives only the names of approved authentication environment
entries. Values are inherited directly into the native child, never copied to
the campaign or recorded. Missing descriptor/program and a preflight result of
`missing`, `unsafe`, or `unauthenticated` produce `unverified` without a
behavioral launch. Once preflight reports `available-safe`, any behavioral
nonzero exit, timeout, authentication error, mutation, malformed envelope, or
size-cap breach fails. Launch uses argv arrays, `shell: false`, fixed byte caps,
and the adapter-enforced sandbox/process-tree policy.

## Host result contract

Each trusted adapter invocation returns exactly one canonical schema-v1 JSON
envelope on stdout. There are three variants:

- `preflight`: adapter/child observation, availability, authentication
  disposition, sandbox canary results, process-tree disposition, and declared
  network/tool policy;
- `plan`: controller-assigned scenario/run/host/invocation identities,
  authorization decisions, complete transaction membership, blocked targets,
  proposed target bytes as base64, preimage SHA-256 values, and a machine
  report draft.
- `verify`: the same controller identities, zero or more proposed operations,
  verification findings, and a host findings draft.

One authoritative `CONTRACT_DEFINITIONS` data structure drives both the
hand-written recursive validator and generated public Draft 2020-12 schemas.
Schema-parity tests mutate every required field, type, enum, conditional
variant, and `additionalProperties: false` boundary. Node has no external schema
validator. Expected hashes/statuses, controller nonces, private bodies, and
recovery bytes remain private.

The controller owns the final machine report. It merges validated host findings
with all later controller inventories, snapshots, privacy checks, controls, and
grades, then renders the six human Markdown sections. Host output cannot omit or
invent later controller observations.

Public layout is exact:

```text
protocol/protocol-v2.schema.json
protocol/host-envelope-v2.schema.json
protocol/evidence-v2.schema.json
hosts/<host>/evidence/events.json
hosts/<host>/evidence/inventory-<n>-stdout.json
hosts/<host>/evidence/inventory-<n>-receipt.json
hosts/<host>/evidence/report.json
hosts/<host>/evidence/report.md
hosts/<host>/result.json
results/aggregate.json
```

Controller/recovery/raw/staging files remain outside this public set.

## Controller-owned phase machines

Every completed phase appends one controller event in memory:

```text
schemaVersion, runId, host, invocationId, sequence, phase,
previousEventSha256, startedAt, completedAt,
beforeSnapshotSha256, afterSnapshotSha256,
inputBlobRefs, outputBlobRefs, disposition
```

Events are canonical JSON and predecessor-bound. After all child processes
exit, the controller atomically seals the event journal and content-addressed
public blobs. No worker process is running while public evidence is written.

### AUDIT

```text
prepared
→ inventory-1 captured by controller
→ plan host invocation captured and stopped
→ inventory-2 captured by controller
→ verify host invocation captured and stopped
→ inventory-3 captured by controller
→ unchanged target snapshot verified
→ final report rendered and evidence sealed
```

No recovery root may be created. All three normalized inventories and target
snapshots must be equal. Fixture grading asserts the complete closed source set
plus scenario-specific states; extra inspector sources are not silently
dropped.

### APPLY

```text
prepared
→ inventory-1 captured by controller
→ plan invocation captured and process tree stopped
→ proposal and authorization validated
→ complete recovery created, privacy verified, and sealed
→ prewrite hashes and permissions rechecked
→ controller applies pass-1 transactions
→ pass-1 filesystem/static verification
→ inventory-2 captured by controller
→ fresh verify invocation captured and process tree stopped
→ zero-operation/idempotence requirement checked
→ inventory-3 captured by controller
→ unchanged pass-2 snapshot verified
→ final report rendered and evidence sealed
```

The verify invocation has a distinct invocation ID, process, nonce, and output
blob. It must propose zero writes and no backup. Inventory 2 and 3 normalize to
the same manifest. If pass 2 fails, the controller restores the private
post-pass-1 checkpoint only after the child process is known stopped.

### PARTIAL

```text
prepared
→ inventory-1 captured by controller
→ plan invocation captured and process tree stopped
→ safe/blocked transaction membership validated
→ complete recovery created and privacy verified
→ controller applies the private concurrent marker
→ prewrite hashes and permissions rechecked
→ conflicting Claude transaction excluded
→ controller applies independent safe transactions
→ private verifier returns fail
→ controller rolls back project-shared only
→ private verifier returns pass
→ inventory-2 captured by controller
→ read-only verify/report invocation captured and process tree stopped
→ inventory-3 and unchanged final snapshot verified
→ final report rendered and evidence sealed
```

The Codex-global transaction remains applied. The concurrent Claude-global
transaction remains untouched after the marker. The project pair is restored
byte-for-byte. The ambiguous nested target remains blocked and unchanged.

## Inventory provenance

The controller executes `process.execPath` and a pinned copy of `inventory.mjs`
with exact explicit `--host both`, `--cwd`, `--project`,
`--home`, `--codex-home`, `--claude-home`, and `--claude-managed-dir` argv.
It also passes `--git-executable` with a controller-resolved absolute Git binary.
Before and after each execution it rechecks Node, inspector, Skill bundle, and
Git identity hashes. Git runs with system/global configuration disabled,
optional locks/fsmonitor/hooks/external diff/filters disabled where applicable,
and no repository-controlled executable hook. The controller captures exact
argv, cwd, environment-name/digest record, exit code, stdout/stderr bytes, raw
stdout hash, and normalized-manifest hash.

Worker output cannot supply or replace inventory bytes. The fixture grade uses
the full manifest and validates root records, every expected source, no extra
source, state, byte size/hash/contribution, chain membership, warnings, and
coverage. Real runs report partial coverage explicitly when the inspector does.

## Recovery and privacy

Before the first target write, the controller creates every preimage,
representation record, permission record, manifest, and restoration record,
then reopens and hashes them. No host process is running during recovery or
target writes.

- Linux/WSL: directories use `0700`, files use `0600`, effective UID ownership,
  `nlink === 1`, and absence of group/other bits are verified. A fixed
  `getfacl --absolute-names --numeric` parser must show no named/default grant
  to another principal; missing/unparseable `getfacl` blocks mutation.
- macOS: the same mode/owner/link predicates apply and a fixed `/bin/ls -led`
  parser must show no extended ACL entry granting another principal access;
  missing/unparseable ACL output blocks mutation.
- Windows: a controller-owned PowerShell/.NET ACL operation establishes a
  protected DACL for the current owner SID before the first preimage is written,
  then returns JSON `{ ownerSid, protected, rules }`. Allow ACEs are permitted
  only for the owner SID, LocalSystem `S-1-5-18`, and Builtin Administrators
  `S-1-5-32-544`; no inherited or broad Everyone/Users/Authenticated Users ACE
  is allowed. Reparse points, `nlink !== 1`, missing helper, unsupported
  filesystem, or unparseable output blocks mutation.
- An unsupported filesystem, unavailable ACL helper, broad ACE, wrong owner,
  link, alias, or unreadable permission state blocks APPLY/PARTIAL before target
  mutation.

Privacy is rechecked for the leaf and every descendant after recovery creation
and again during grading. Public evidence contains paths, hashes, membership,
and privacy dispositions, never preimage bytes.

## Secret scanning and publication

All public artifacts are staged outside the final evidence tree and scanned
before atomic publication. The scanner checks:

- raw bytes;
- strict UTF-8, UTF-8 BOM, UTF-16LE, and UTF-16BE text;
- JSON keys and string values after escape decoding;
- newline-normalized Unicode NFC and NFKC forms;
- percent, hex, base64, and base64url representations;
- known sentinels, complete private fixture bodies, and nonblank normalized
  body lines of at least eight characters.

Invalid or undecodable public formats fail. Private host raw output and private
recovery blobs are not published. The public claim is
`known-sensitive-fixture-nondisclosure`, not general secret absence.

## Crash recovery

Before target mutation, the controller persists an append-only owner-private
journal with exclusive creation, fsync, predecessor hashes, and recovery blob
references. `recover` reconstructs the last sealed controller phase.

- Before recovery seal: no target write was authorized.
- During an uncommitted transaction: restore every member.
- After an independent committed transaction: retain it.
- During APPLY pass 2: restore the private post-pass-1 checkpoint.
- Missing/corrupt recovery bytes or an uncertain live child: return `blocked`
  and perform no further write.

The controller cannot portably kill an unknown descendant tree after its own
crash. Recovery remains blocked until the recorded child is known stopped.

## Grading

`grade` uses only controller events, controller-captured blobs, private fixture
expectations, recovery material, and the final filesystem. Host reports are
claims that must agree with those facts.

Per-host outcomes:

- `pass`: every required controller-observed claim passed;
- `unverified`: the selected host was wholly unavailable or unsafe to launch;
- `fail`: a launch began but any protocol, semantic, privacy, mutation,
  recovery, evidence, or report check failed;
- `blocked`: safe recovery or an authorized transaction could not be completed.

`protocolOutcome` and `taskOutcome` are separate. The expected PARTIAL
`blocked-decision` target is a correct task disposition and may coexist with
`protocolOutcome: pass` and `taskOutcome: completed-with-blocked-decision`.
Overall `blocked` is reserved for an operational/safety condition that prevents
an otherwise authorized transaction or recovery.

The dual-host result is `fail` if either host fails, `blocked` if no host fails
and either blocks, `unverified` if no host fails/blocks and either is
unverified, otherwise `pass`.

## Verification scenarios

Keep exactly three forward tests, one for each scenario. Each test launches a
real child-process fake adapter; tests never create passing controller events,
inventories, receipts, recovery data, or reports.

- AUDIT rejects target mutation, wrong self-claimed host, fabricated inventory,
  encoded canary leakage, and malformed present output; missing launcher is
  `unverified`.
- APPLY proves recovery precedes writes, privacy is enforced, a fresh second
  process proposes no operations, replay/tamper/extra recovery leaves fail, and
  fresh-process recovery is correct and idempotent after injected crashes at
  every persisted/mutation boundary.
- PARTIAL proves marker ordering, concurrent exclusion, independent commit,
  verifier fail, selective rollback, verifier success, ambiguity preservation,
  and encoded secret rejection.

Real-host execution remains a separate final gate. Process exit success alone
is not semantic success; review controller events, raw-output hashes, target
diffs, and graded claims.
