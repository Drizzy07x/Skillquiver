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

## Current boundary

- The first isolated description candidate was rejected after 24 paired model
  runs; its exact result is recorded in
  [`2026-08-13-skillhex-candidate-1.md`](../results/2026-08-13-skillhex-candidate-1.md).
- The source skill remains unchanged.
- The original four evaluator-only cases are no longer held out from campaign
  authors and are development evidence only for subsequent campaigns.
- New evaluator-only cases must be frozen in Git before the next candidate is
  drafted, and candidate payloads must remain unable to read them.
