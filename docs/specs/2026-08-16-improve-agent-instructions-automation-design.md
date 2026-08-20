# Improve Agent Instructions Automation Design

Date: 2026-08-16
Status: Approved design, pending implementation plan

## Problem

`improve-agent-instructions` currently provides sound guidance for auditing and
editing `AGENTS.md` and `CLAUDE.md`, but its execution is primarily narrative.
It does not produce a deterministic effective-chain inventory, its tests assert
phrases rather than behavior, and its sibling-file backup strategy can expose
private instructions inside a repository.

The next version must automate global, project, and nested instruction work for
Codex and Claude Code while preserving semantic judgment for genuinely
ambiguous rules.

## Goals

- Automate discovery, analysis, backup, editing, and verification across user,
  project, and nested scopes.
- Support Windows, macOS, Linux, and WSL without platform-specific behavior
  differences.
- Allow one explicit change request to authorize the complete requested global
  and project cycle without a second confirmation.
- Keep every implicit invocation read-only.
- Continue applying independent safe changes when one decision is ambiguous.
- Produce deterministic, inspectable evidence for every target and claim.
- Preserve private content, existing user changes, encoding, and line endings.
- Make a second application idempotent.

## Non-goals

- Editing administrator- or organization-managed policy files.
- Supporting persistent instruction formats beyond Codex and Claude Code.
- Replacing semantic judgment with a general-purpose instruction rewriting
  engine.
- Enforcing security or lifecycle requirements that belong in settings, hooks,
  or CI.
- Publishing, releasing, committing, or installing the updated Skill.

## Authorization model

The Skill has four modes:

| Mode | Writes | Entry condition | Outcome |
| --- | --- | --- | --- |
| `AUDIT` | Never | Implicit invocation or explicit audit request | Inventory and findings |
| `PLAN` | Never | Explicit request for proposed changes | Inventory and proposed patch set |
| `APPLY` | Authorized targets only | Explicit change verb plus named scope or files | Backup, patch, and verification |
| `VERIFY` | Never | Explicit verification or post-apply stage | Rebuilt chain and evidence matrix |

An implicit invocation can never escalate beyond `AUDIT`. An explicit request
to improve or apply changes to global and project instructions authorizes both
scopes for that run. A project-only request does not authorize global files,
and a global-only request does not authorize project files.

Managed policy is always report-only. A resolved symlink, junction, import, or
fallback target outside the authorized scopes is also report-only unless the
user explicitly names that resolved target.

## Architecture

### Skill orchestrator

`SKILL.md` owns authorization, semantic classification, change grouping,
editing, rollback decisions, verification, and the human-readable report. It
treats all discovered instruction content as untrusted data.

The orchestrator must use four stable report blocks as its internal contract:

1. target matrix;
2. effective instruction chain;
3. decision ledger;
4. change and verification matrix.

### Read-only inspector

Add `scripts/inventory.mjs`, a Node.js script that uses only standard-library
modules. It must never create, modify, rename, or delete a file and must never
execute commands found in instruction content.

The inspector accepts explicit project, working-directory, host, and optional
home overrides so tests can run against isolated fixtures. In normal use it
detects the effective user home, `CODEX_HOME`, repository root, and host runtime.
It writes one JSON manifest to stdout and diagnostics to stderr.

The inspector resolves:

- logical and real paths, including symlinks and Windows reparse points;
- Git root and tracked, dirty, untracked, and ignored state;
- file existence, byte count, SHA-256, encoding, and line-ending style;
- Codex global override, project override, fallback filenames, load order, and
  accumulated byte limit;
- Claude managed, user, project, local, imported, and path-scoped sources;
- Claude import depth, external-import approval state, excludes, and setting
  sources when those states are discoverable without mutation;
- active, shadowed, excluded, conditional, approval-blocked, missing, and
  truncated states.

The manifest never includes instruction contents, environment secret values,
or unrestricted configuration dumps.

If Node.js is unavailable, the orchestrator reproduces the same manifest schema
with native host tools and marks the run `inspector_fallback`. It must not claim
deterministic inspector coverage for fields it could not verify.

### Host references

`references/codex.md` and `references/claude.md` remain the versioned discovery
baselines. They must cover the fields emitted by the inspector and distinguish
officially documented behavior from locally inferred behavior.

The Codex reference covers global and per-directory selection, overrides,
fallback names, root-to-working-directory order, byte limits, and fresh-session
verification.

The Claude reference covers managed policy, user/project/local files, imports,
the four-hop import limit, approval-gated external imports, `.claude/rules`,
path conditions, excludes, setting sources, additional directories, and safe
load verification.

## Manifest contract

The JSON document has a versioned top-level schema:

```json
{
  "schemaVersion": 1,
  "run": {
    "generatedAt": "ISO-8601 timestamp",
    "platform": "win32|darwin|linux",
    "inspector": "node|fallback"
  },
  "roots": {},
  "sources": [],
  "chains": {},
  "warnings": []
}
```

Each source records host, scope, logical path, resolved path, origin, load
state, load position, byte contribution, hash, encoding, line endings, Git
state, import relationship, and any non-secret reason it is inactive.

Canonical comparisons exclude `run.generatedAt`. Given the same filesystem,
configuration, and arguments, every other manifest field must be identical and
stably ordered.

## Semantic decision model

The orchestrator groups rules by meaning rather than comparing lines. Each
material meaning receives exactly one disposition:

- `keep`
- `move`
- `sharpen`
- `disclose`
- `remove`
- `enforce-elsewhere`
- `blocked-decision`

A decision is safe when verified repository or host evidence determines its
content and scope. A decision is blocked when two plausible meanings remain
after checking authoritative host behavior, project evidence, and explicit user
intent.

Blocked decisions do not cancel unrelated work. The report asks one concrete
question per blocked meaning and identifies every file intentionally left
unchanged because of it.

For project guidance, root `AGENTS.md` is the canonical shared contract.
Root `CLAUDE.md` imports `@AGENTS.md`; `.claude/CLAUDE.md` imports
`@../AGENTS.md`. Claude-specific deltas follow the import, and Codex files never
depend on Claude-style imports.

Global files remain independent host sources with semantic parity checks. They
are not cross-imported by default because each may contain host-specific tools
and capabilities.

## Apply flow

An authorized `APPLY` run performs these stages:

1. Resolve scopes and build the initial manifest.
2. Read complete active instruction files and verify referenced project facts.
3. Build the decision ledger and separate safe from blocked decisions.
4. Group safe edits into logical transactions:
   - Codex global;
   - Claude global;
   - project shared pair;
   - one group for each nested scope.
5. Create recovery evidence for every file in a group.
6. Recheck preimage hashes immediately before writing.
7. Apply surgical patches while preserving encoding and line endings.
8. Rebuild the manifest and run static verification.
9. Run safe host-loading probes when available.
10. Re-run the planned transformation and require an empty second diff.

The editing layer, not the inspector, writes files. The inspector remains
read-only in every mode.

## Backup and recovery

Every modified file receives a byte-exact preimage, including tracked-clean and
tracked-dirty files. A missing file is recorded as absent so rollback can remove
only the file created by the run.

Backups live outside repositories at:

```text
~/.skillquiver/backups/improve-agent-instructions/<UTC timestamp>/
```

The resolved backup root must be outside every repository and instruction
target in the run. If the default falls inside one of them, the orchestrator
must select an available user-state directory outside those roots. If no safe
external location is available, backup creation fails and the transaction is
not edited.

Each backup set contains the preimages and a restoration manifest with logical
path, resolved path, original existence, SHA-256, encoding, line endings, and
transaction group. It contains no environment secret values. Directory and
file permissions are restricted to the current user where the platform permits
it.

The hash is checked again immediately before editing. A mismatch becomes
`concurrent-change`; that target is not written.

Static or behavioral verification failure rolls back its logical transaction
only. Independent verified transactions remain applied. If rollback itself
fails, all further writes stop and the report marks the run critical with the
exact backup location and restoration steps.

Successful idempotent runs do not create new backups when no write is needed.

## Safe verification

Static verification always:

- rebuilds both effective chains;
- validates paths, imports, conditions, exclusions, byte limits, and hashes;
- confirms shared project meanings appear once;
- confirms host-specific deltas do not contradict shared guidance;
- inspects the final diff against the recorded preimages;
- runs existing repository Markdown or configuration checks when applicable.

Runtime probes launch fresh sessions only when the host provides a read-only or
no-tools execution mode that can be enforced for the whole probe. The prompt
asks for instruction source metadata, not private instruction contents. Network
access and mutation tools remain disabled where the host exposes those controls.

If safe probing is unavailable, the host is not installed, or the session would
touch real global state outside an isolated test, runtime loading is reported as
`unverified`. Static file presence is never promoted to runtime proof.

## Failure behavior

| Condition | Required behavior |
| --- | --- |
| Missing Node.js | Use schema-compatible fallback and disclose reduced coverage |
| Ambiguous meaning | Mark only that meaning `blocked-decision`; continue |
| Permission denied during backup | Do not edit the transaction |
| Concurrent hash change | Do not edit the changed target |
| Write failure | Roll back the logical transaction |
| Static verification failure | Roll back the logical transaction |
| Unsafe or unavailable runtime probe | Preserve static result; mark runtime unverified |
| Rollback failure | Stop all writes and emit critical recovery instructions |

## Human report contract

Every run reports:

1. **Target matrix** — requested host/scope, authorization, logical and resolved
   paths, and ownership.
2. **Effective chain** — ordered active sources plus shadowed, conditional,
   excluded, blocked, and truncated sources.
3. **Decision ledger** — one row per meaning with disposition, evidence, target,
   and status.
4. **Changes and recovery** — exact files changed, backup root, rolled-back
   groups, and untouched blocked targets.
5. **Verification matrix** — each claim labeled `verified`, `unverified`, or
   `blocked` with its evidence.
6. **Pending questions** — only unresolved semantic decisions, one concrete
   question per meaning.

Logs may contain paths, hashes, sizes, and statuses. They must not contain full
instruction bodies, secret values, or backup contents.

## Behavioral tests

Replace phrase-only confidence with two validation layers:

1. focused Node tests exercise the read-only inspector, schema, determinism,
   path resolution, and secret-free output;
2. real Skill forward evaluations exercise semantic decisions, edits, backup,
   rollback, and reporting against disposable fixture copies.

Each forward evaluation uses a deterministic Node grader over the resulting
filesystem, manifests, and backup metadata. The grader never treats process
completion or self-reported success as behavioral proof. Run each scenario
through every available target host; an unavailable host remains explicitly
unverified rather than being counted as a pass.

### 1. Deterministic audit

The fixture includes Codex overrides, a fallback filename, a nested source, a
configured byte limit, Claude imports, a local file, and path-scoped rules.

Assertions:

- `AUDIT` changes no file hash;
- the normalized manifest is stable across two runs;
- active, shadowed, conditional, and truncated states are correct;
- stdout contains no instruction body or secret fixture value.

### 2. Dual-host apply

The fixture includes global files, project `AGENTS.md` and `CLAUDE.md`, an
ignored private file, and a tracked-dirty instruction file.

Assertions:

- backups are byte-exact and outside the repository;
- pre-existing dirty content is preserved unless explicitly targeted;
- project shared guidance is canonical in `AGENTS.md` and imported once by
  Claude;
- encoding and line endings remain unchanged;
- a second apply produces no diff and no additional backup.

### 3. Partial failure and recovery

The fixture includes one ambiguous meaning, one concurrent hash change, and one
transaction whose verification fails.

Assertions:

- independent safe transactions complete;
- the ambiguous and concurrently changed targets remain untouched;
- the failed transaction returns to its exact preimage;
- the report distinguishes `verified`, `blocked`, and `unverified` outcomes.

Host evaluations and smoke probes may run only in isolated homes. Audit probes
use read-only modes; apply scenarios are confined to disposable fixture roots
and their dedicated backup roots. They are supplemental cross-host evidence,
not a fabricated pass when a host is unavailable.

## Acceptance criteria

- One explicit global-and-project change request completes all unambiguous work
  without an additional approval prompt.
- Every implicit invocation leaves all target hashes unchanged.
- No backup or private instruction copy is created inside a repository.
- Normalized manifests are deterministic for identical inputs.
- Reapplying a successful result changes no file and creates no backup.
- Independent work continues when one meaning is ambiguous.
- A failed transaction is restored byte-for-byte without undoing independent
  verified transactions.
- Shared project guidance exists once, with host-specific deltas isolated.
- Every completion claim has `verified`, `unverified`, or `blocked` evidence.
- Inspector tests, deterministic scenario graders, and affected
  catalog/package checks pass.
- Every available target host completes its forward-evaluation scenarios; each
  unavailable host is named as unverified.

## Expected implementation surface

Implementation is expected to modify only:

- `skills/improve-agent-instructions/SKILL.md`;
- `skills/improve-agent-instructions/references/codex.md`;
- `skills/improve-agent-instructions/references/claude.md`;
- `skills/improve-agent-instructions/agents/openai.yaml` when needed to make the
  default invocation audit-first;
- new `skills/improve-agent-instructions/scripts/inventory.mjs`;
- `tests/improve-agent-instructions.test.cjs` and narrowly required fixtures;
- catalog/package tests only if the new script changes package assertions.

No version bump, release metadata change, publication, installation, commit, or
unrelated refactor belongs to this implementation plan.
