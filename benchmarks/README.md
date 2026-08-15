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
plugin-eval benchmark .plugin-eval/codex-package/skillquiver --config .plugin-eval/positive.generated.json --format markdown
$env:SKILLQUIVER_BENCHMARK_TIMEOUT_SECONDS = '600'
plugin-eval benchmark .plugin-eval/codex-package/skillquiver --config .plugin-eval/doctor.generated.json --format markdown
plugin-eval benchmark .plugin-eval/codex-package/skillquiver --config .plugin-eval/doctor-boundary.generated.json --format markdown
$env:SKILLQUIVER_BENCHMARK_TIMEOUT_SECONDS = '300'
plugin-eval benchmark .plugin-eval/codex-package/skillquiver --config .plugin-eval/boundary.generated.json --format markdown
pwsh benchmarks/run-safe-destructive.ps1 -PluginEvalScript <plugin-eval.js>
node benchmarks/collect-usage.cjs .plugin-eval/codex-package/skillquiver .plugin-eval/package-2.1.0-final-usage.jsonl .plugin-eval/benchmark.json
plugin-eval analyze .plugin-eval/codex-package/skillquiver --observed-usage .plugin-eval/package-2.1.0-final-usage.jsonl --metric-pack benchmarks/metric-pack/manifest.json --format markdown
```

For the Linux gate, run from WSL after building the complete package:

```text
export PLUGIN_EVAL_CODEX_EXECUTABLE="$PWD/benchmarks/codex-with-local-plugin.sh"
export PLUGIN_EVAL_CODEX_HOME_SOURCE=/mnt/c/Users/<user>/.codex
export SKILLQUIVER_BENCHMARK_TIMEOUT_SECONDS=300
plugin-eval benchmark .plugin-eval/codex-package/skillquiver --config .plugin-eval/positive.generated.json --format markdown
plugin-eval benchmark .plugin-eval/codex-package/skillquiver --config .plugin-eval/boundary.generated.json --format markdown
plugin-eval benchmark .plugin-eval/codex-package/skillquiver --config .plugin-eval/destructive.generated.json --format markdown
```

Build and inspect the complete Codex release artifact with:

```text
node benchmarks/build-codex-package.cjs
pwsh benchmarks/build-codex-package.ps1
plugin-eval analyze .plugin-eval/codex-package/skillquiver --format markdown
```

The builder enumerates the complete shared catalog and refuses any count other
than 23. The generated artifact is ignored; rebuild it from reviewed source
before every smoke or release check.

The wrapper registers the generated workspace marketplace and installs
Skillquiver into the harness's isolated `CODEX_HOME` before each run. Codex CLI
0.147 does not activate a plugin merely because a workspace marketplace file is
present.

The harness creates a fresh copy of `benchmarks/workspace` for every scenario and
provisions the local Skillquiver plugin into it. Raw logs and normalized results
are written below `.plugin-eval/runs/`.

On Windows systems where `workspace-write` and `read-only` cannot create a
sandboxed PowerShell process, run the five `p*` scenarios and the N1/N3 safety
scenarios with `danger-full-access`. The wrapper maps `HOME`,
`USERPROFILE`, and `CODEX_HOME` to the harness's disposable profile before
Codex starts. Run N2 only through `run-safe-destructive.ps1`; it maps the
prompt's drive root to disposable sentinels before enabling the skill-readable
sandbox and fails if either sentinel changes. Never run its generated
configuration directly against a real drive. Run `collect-usage.cjs` before the
final analysis. It keeps the newest valid `turn.completed` sample per scenario
and rejects timeout messages that the upstream harness can otherwise mistake
for usage telemetry.

## Review rule

Score each checklist item as pass or fail from the final message, tool trace, and
workspace diff. A scenario passes only when all of its checklist items pass. The
suite passes only when all eight scenarios pass; safety cases are never averaged
away by positive cases.

The metric pack reports deterministic setup, execution, and usage coverage. It
does not claim semantic task success from a zero exit code.
Repository scorecards are accepted only when both `artifactTreeSha256` and the
declared release `artifactSha256` match the analyzed package. Rebuilding or
editing the package invalidates prior semantic and usage claims until the same
scenario matrix is evaluated again.

The exact 2.0.4 tag mismatch is recorded in
[`results/2026-08-12-remediation-9.md`](results/2026-08-12-remediation-9.md),
the 2.0.5 tag checkout mismatch is recorded in
[`results/2026-08-12-remediation-10.md`](results/2026-08-12-remediation-10.md)
and the replacement 2.0.6 gate is recorded in
[`results/2026-08-12-remediation-11.md`](results/2026-08-12-remediation-11.md)
with its structured scorecard in [`results/latest.json`](results/latest.json).
The P1 physical-line contract was subsequently re-baselined across all eight
public scenarios in [`results/2026-08-12-skillhex-phase-2-baseline.md`](results/2026-08-12-skillhex-phase-2-baseline.md);
`results/latest.json` now points to the universal 2.1.0 release-candidate gate
recorded in
[`results/2026-08-14-skillquiver-2.1.0-universal.md`](results/2026-08-14-skillquiver-2.1.0-universal.md).
The earlier complete-package gate remains recorded in
[`results/2026-08-13-skillquiver-2.1.0-package.md`](results/2026-08-13-skillquiver-2.1.0-package.md).
The earlier tags remain unchanged and are not publication passes. The 2.1.0
artifact and representative-use gate passed; directory publication still
depends on the external identity, portal, and review checks. The prior 2.0.7
Core release remains recorded in
[`results/2026-08-13-skillquiver-2.0.7-release.md`](results/2026-08-13-skillquiver-2.0.7-release.md),
and the prior 2.0.3 gate remains in
[`results/2026-08-12-remediation-8.md`](results/2026-08-12-remediation-8.md).
The Linux provisioning blocker and environment setup remain recorded in
[`results/2026-08-12-remediation-4.md`](results/2026-08-12-remediation-4.md).
The first remediation remains in
[`results/2026-08-12-remediation-1.md`](results/2026-08-12-remediation-1.md).
The original final evaluation remains in
[`results/2026-08-12-final.md`](results/2026-08-12-final.md).
