# SkillHEX pilot infrastructure

This directory contains the offline staging and evaluation boundary for the
Skillquiver host-boundaries campaigns. The infrastructure does not generate
candidate patches or launch model runs itself.

## Candidate staging

`staging.cjs` extracts the target skill and plugin manifest from the campaign's
frozen Git commit. The destination must be outside the repository and must not
already contain the candidate ID.

```powershell
$stageRoot = New-Item -ItemType Directory -Path (
  Join-Path ([IO.Path]::GetTempPath()) ([guid]::NewGuid()))
node benchmarks/skillhex/staging.cjs stage `
  benchmarks/skillhex/host-boundaries.campaign.json `
  baseline-control `
  $stageRoot.FullName
```

The staged directory contains only:

- the frozen Codex plugin manifest;
- the frozen logo referenced by that manifest;
- the frozen `handle-host-boundaries` skill;
- `candidate.json`, with the source commit and payload digest.

Each candidate gets its own parent directory and an inner `skillquiver`
plugin root, preserving the manifest-name/directory-name contract.

It does not contain the campaign ledger or evaluator cases. The command refuses
to overwrite an existing candidate directory and never writes to `skills/`.

## Independent evaluator

Prepare a baseline control and candidate in separate stage directories, then
create the evaluator package in a third directory outside the repository:

```powershell
$evaluationRoot = New-Item -ItemType Directory -Path (
  Join-Path ([IO.Path]::GetTempPath()) ([guid]::NewGuid()))
node benchmarks/skillhex/evaluator.cjs prepare `
  benchmarks/skillhex/host-boundaries.campaign.json `
  <baseline-stage> `
  <candidate-stage> `
  $evaluationRoot.FullName
```

Preparation verifies both identities and digests, anchors the baseline and the
candidate's lineage to the frozen Git payload, requires all three roots to be
disjoint, and rejects evaluator-only case IDs, prompts, or checklist text found
in the candidate payload or metadata. Only the evaluator package receives the
four held-out cases.

`prepare` records a three-repeat paired policy with varied baseline/candidate
order. It does not launch a model or mark any case executed.

After an independent reviewer supplies a complete assessment, score it with:

```powershell
node benchmarks/skillhex/evaluator.cjs score `
  benchmarks/skillhex/host-boundaries.campaign.json `
  <evaluation.json> `
  <assessment.json>
```

The scorer reloads the held-out rubric from its frozen Git commit and requires
every case and repeat exactly once, both paired orders per case, matching
digests, checklist-level `pass`, `fail`, or `inconclusive` results, and evidence
for every checklist item. Behavior is scored before token cost.
Any candidate hard-contract failure is rejected. A better candidate is only
`eligible-for-human-review`; this infrastructure never promotes automatically.

## Installed paired runner

`runner.cjs` executes a prepared evaluation only after installing each sealed
payload through Codex's plugin CLI in a fresh isolated home. Copying a local
marketplace entry is not installation: every one-use run adds the marketplace,
installs and enables `skillquiver@plugin-eval-benchmark`, and verifies the
installed payload digest before starting Codex.

```powershell
node benchmarks/skillhex/runner.cjs run `
  <evaluation.json> `
  benchmarks/workspace `
  <execution-root>
```

The runner freezes three paired repeats, uses a fresh workspace and Codex home
for each role, captures JSONL events and workspace changes, and removes the
ephemeral home so authentication data is never retained with the evidence.
It records process evidence only; checklist assessment and scoring remain
independent steps.

## Current boundary

- Candidates 1 through 3 were rejected under the all-hard-contracts policy;
  their reports remain under `benchmarks/results`.
- Candidate 4 passed 36/36 checklist observations across 24 held-out paired
  runs and was promoted to `handle-host-boundaries` after human review.
- Skillquiver Core 2.0.7 then passed the complete public matrix 8/8 and 29/29.
- Every evaluator case opened during this pilot is now development evidence.
  A future campaign must commit new evaluator-only cases before drafting a
  candidate, and candidate payloads must remain unable to read them.
