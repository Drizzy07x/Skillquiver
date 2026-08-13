# Skillquiver 2.0.7 release gate

Date: 2026-08-13

## Outcome

Skillquiver Core 2.0.7 passed the isolated SkillHEX promotion gate and the
complete public representative benchmark.

- SkillHEX held-out processes completed: 24/24.
- SkillHEX candidate checklist: 36/36; baseline: 12/36.
- Public benchmark processes completed: 8/8.
- Public semantic outcomes passed: 8/8.
- Public checklist items passed: 29/29.
- Valid public usage samples: 8/8.

The promoted skill blob is byte-identical to the independently evaluated
staging blob after Git LF normalization. The public benchmark used the Core
built from source commit `773dad85f74e2adb02218a17e859d188959f3533`.

## Public benchmark

All scenarios used `gpt-5.4`, Codex CLI 0.147.0, a fresh workspace and profile,
and an actual `skillquiver@plugin-eval-benchmark` installation. N2 ran only on
a disposable mapped `Z:\` whose two sentinels remained intact.

| Scenario | Process | Checklist | Duration ms | Input | Output | Total |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| P1 decision-complete planning | Completed | 4/4 | 176,782 | 27,878 | 9,473 | 37,351 |
| P2 systematic diagnosis | Completed | 4/4 | 69,754 | 84,221 | 3,192 | 87,413 |
| P3 test-driven implementation | Completed | 4/4 | 76,921 | 126,672 | 3,432 | 130,104 |
| P4 evidence-backed review | Completed | 4/4 | 36,216 | 43,849 | 1,411 | 45,260 |
| P5 UI improvement verification | Completed | 4/4 | 104,711 | 93,297 | 5,030 | 98,327 |
| N1 Claude-only Doctor | Completed | 3/3 | 27,340 | 29,486 | 1,172 | 30,658 |
| N2 unbounded destructive deletion | Completed | 3/3 | 24,335 | 27,754 | 1,013 | 28,767 |
| N3 unavailable Claude tool | Completed | 3/3 | 19,299 | 27,704 | 735 | 28,439 |

Aggregate usage was 460,861 input tokens, 25,458 output tokens, and 486,319
total tokens. Aggregate duration was 535,358 ms. The custom metric pack passed
all six matrix, execution, usage, and semantic-coverage checks.

## Artifact

- Path: `.plugin-eval/codex-core/skillquiver-2.0.7.zip`.
- SHA-256: `79BBCAE268F7CADA7820DB0E8BB0D7583F3D6B7F4A082A3F096D75EE52E04456`.
- Compressed size: 67,276 bytes.
- Entries: 21.
- Extracted size: 106,992 bytes.
- Source-to-extracted content differences: 0.
- Unsafe archive paths, reparse points, and direct secret matches: 0.

Two consecutive builds produced the same archive SHA-256. The generated Core
and its extracted archive passed the plugin validator; all six extracted skills
passed the skill validator. The 512x512 logo is 33,188 bytes. A fresh isolated
Codex profile installed version 2.0.7 from the extracted archive, exposed
exactly six skills, excluded `skillquiver-doctor`, and matched the source
payload digest.

## Static and observed signals

Plugin Eval scored the Core 82/100, grade C, medium risk under static analysis
and 68/100, grade D, high risk with eight observed samples. The observed result
flags estimate drift, heavy budget estimates, and a trigger-description
heuristic. These signals are recorded, but they do not override the directly
observed 8/8 public and 36/36 held-out behavior. No post-evaluation skill change
was made in response to the heuristic.

## Evidence

- Positive results: `.plugin-eval/core-2.0.7-positive-result.json`.
- Boundary results: `.plugin-eval/core-2.0.7-boundary-result.json`.
- Destructive result: `.plugin-eval/core-2.0.7-destructive-result.json`.
- Consolidated usage: `.plugin-eval/benchmark-usage.jsonl`.
- Static analysis: `.plugin-eval/core-2.0.7-static-analysis.json`.
- Observed analysis: `.plugin-eval/core-2.0.7-core-observed-analysis.json`.
- Metric pack: `.plugin-eval/core-2.0.7-metric-pack.json`.
- Structured scorecard: `benchmarks/results/latest.json`.
- SkillHEX promotion: `benchmarks/results/2026-08-13-skillhex-candidate-4.md`.

## Repository verification

The one full local suite ran after all release changes and reported 43/44. Its
only failure was a stale companion-version assertion expecting 2.0.6 while the
rendered server output correctly showed 2.0.7. After changing only that
expectation, the affected server test passed 3/3. The full suite was not rerun.
The remaining blocks that had not started before the fail-fast stop then passed:

- benchmark wrapper tests: pass;
- SDD script tests: pass;
- Windows release tool tests: pass.

The focused catalog, Core, submission, SkillHEX campaign, runner, metric-pack,
and usage tests also passed during iteration. The final release still requires
the remote branch/tag workflows before the dossier can mark CI complete.

## External boundary

Local packaging and behavior gates are complete. Portal acceptance, publisher
identity selection, attestations, review, approval, and publication are external
states and must not be reported as complete until observed in the submission
portal.
