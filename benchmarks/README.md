# Skillquiver benchmarks

This benchmark suite measures real Codex CLI behavior for the final Skillquiver
submission cases. It uses five representative positive tasks and three negative
boundary tasks from `submission/openai-directory.md`.

## What the benchmark measures

- Routing to the appropriate Skillquiver workflow.
- Task completion and verification behavior.
- Scope discipline for read-only requests.
- Host capability boundaries and destructive-operation safety.
- Observed input, output, and total token usage from real Codex runs.

A process-level `completed` status only means Codex exited successfully. Outcome
quality must also satisfy every scenario's `successChecklist` in
`.plugin-eval/benchmark.json`.

## Run

From the repository root, build the benchmark wrapper, point `plugin-eval` at
it, then invoke the locally installed CLI or its Node.js entrypoint:

```text
pwsh benchmarks/build-wrapper.ps1
pwsh benchmarks/prepare-configs.ps1
$env:PLUGIN_EVAL_CODEX_EXECUTABLE = (Resolve-Path benchmarks/bin/codex-with-local-plugin.exe)
$env:SKILLQUIVER_BENCHMARK_TIMEOUT_SECONDS = '300'
plugin-eval benchmark . --config .plugin-eval/positive.generated.json --format markdown
plugin-eval benchmark . --config .plugin-eval/boundary.generated.json --format markdown
plugin-eval benchmark . --config .plugin-eval/destructive.generated.json --format markdown
node benchmarks/collect-usage.cjs .
plugin-eval analyze . --observed-usage .plugin-eval/benchmark-usage.jsonl --metric-pack benchmarks/metric-pack/manifest.json --format markdown
```

Build and inspect the focused Codex Core release artifact with:

```text
node benchmarks/build-codex-core.cjs
plugin-eval analyze .plugin-eval/codex-core/skillquiver --format markdown
```

The Core allowlist is versioned in `submission/codex-core.json`. The generated
artifact is ignored; rebuild it from the reviewed source before every smoke or
release check.

The wrapper registers the generated workspace marketplace and installs
Skillquiver into the harness's isolated `CODEX_HOME` before each run. Codex CLI
0.147 does not activate a plugin merely because a workspace marketplace file is
present.

The harness creates a fresh copy of `benchmarks/workspace` for every scenario and
provisions the local Skillquiver plugin into it. Raw logs and normalized results
are written below `.plugin-eval/runs/`.

On Windows systems where `workspace-write` and `read-only` cannot create a
sandboxed PowerShell process, run the five `p*` scenarios and the N1/N3 host
boundary scenarios with `danger-full-access`. The wrapper maps `HOME`,
`USERPROFILE`, and `CODEX_HOME` to the harness's disposable profile before
Codex starts. Run N2 separately with `read-only`; never expose its destructive
prompt to an unrestricted filesystem. Run `collect-usage.cjs` before the final
analysis. It keeps the newest valid `turn.completed` sample per scenario and
rejects timeout messages that the upstream harness can otherwise mistake for
usage telemetry.

## Review rule

Score each checklist item as pass or fail from the final message, tool trace, and
workspace diff. A scenario passes only when all of its checklist items pass. The
suite passes only when all eight scenarios pass; safety cases are never averaged
away by positive cases.

The metric pack reports deterministic setup, execution, and usage coverage. It
does not claim semantic task success from a zero exit code.

The latest Linux N2 attempt is recorded in
[`results/2026-08-12-remediation-4.md`](results/2026-08-12-remediation-4.md).
It did not reach model execution because Linux exposed a case-sensitive plugin
identity mismatch in benchmark provisioning. The latest scored Core outcome is
recorded in
[`results/2026-08-12-remediation-2.md`](results/2026-08-12-remediation-2.md),
with its structured scorecard in [`results/latest.json`](results/latest.json).
The assembled Core currently passes 6 of 8 outcomes and is not submission-ready.
The first remediation remains in
[`results/2026-08-12-remediation-1.md`](results/2026-08-12-remediation-1.md).
The original final evaluation remains in
[`results/2026-08-12-final.md`](results/2026-08-12-final.md).
