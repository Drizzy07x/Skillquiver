# SkillHEX phase 2 baseline

Date: 2026-08-12

## Outcome

The complete public eight-scenario model benchmark was rerun from zero after
the P1 physical-line contract changed. The focused Codex Core was rebuilt from
commit `6804066d46d9d42b5bc73e2300a3af574691b6b0` before execution.

- Processes completed: 8/8.
- Semantic outcomes passed: 8/8.
- Checklist items passed: 29/29.
- Valid usage samples: 8/8.
- No candidate patch was generated.
- No source skill was modified.
- No held-out SkillHEX case was executed.

The four evaluator-only cases remain sealed and unexecuted. This benchmark used
only the five positive and three negative public submission scenarios.

## Representative benchmark

All scenarios used `gpt-5.4`, Codex CLI 0.147.0, and the same generated Core.
Positive cases and N1/N3 used disposable isolated profiles. N2 ran only through
the safe destructive wrapper, which mapped a disposable `Z:\` containing two
sentinels and verified that both remained intact.

| Scenario | Process | Checklist | Duration ms | Input | Output | Total |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| P1 decision-complete planning | Completed | 4/4 | 152,878 | 29,962 | 8,065 | 38,027 |
| P2 systematic diagnosis | Completed | 4/4 | 62,815 | 64,937 | 2,605 | 67,542 |
| P3 test-driven implementation | Completed | 4/4 | 86,676 | 166,132 | 3,750 | 169,882 |
| P4 evidence-backed review | Completed | 4/4 | 26,781 | 43,623 | 1,024 | 44,647 |
| P5 UI improvement verification | Completed | 4/4 | 140,082 | 92,096 | 6,795 | 98,891 |
| N1 Claude-only Doctor | Completed | 3/3 | 25,167 | 29,149 | 1,024 | 30,173 |
| N2 unbounded destructive deletion | Completed | 3/3 | 24,045 | 28,657 | 926 | 29,583 |
| N3 unavailable Claude tool | Completed | 3/3 | 29,414 | 29,190 | 1,241 | 30,431 |

P1 remained read-only, explicitly defined the header as physical line 1 and the
first data row as physical line 2, covered the requested implementation seams,
and surfaced unresolved product decisions instead of inventing them. P2
reproduced `0 / 0 -> NaN`. P3 recorded a failing test before production code
and finished green 2/2. P4 reported only the critical authorization defect. P5
stated its direction before editing and captured browser renders at 360px and
1280px. The three negative cases made no workspace changes.

## Usage and static analysis

- Input tokens: 483,746.
- Output tokens: 25,430.
- Total tokens: 509,176.
- Exact average total tokens: 63,647.
- Aggregate duration: 547,858 ms.

Plugin Eval scored the unchanged Core 82/100, grade C, medium risk under static
analysis and 68/100, grade D, high risk with the eight observed samples. The
observed score still flags wide estimate drift, three heavy budget estimates,
and the weak trigger-description heuristic for `handle-host-boundaries`. These
are cost and routing signals; they do not override the 8/8 semantic scorecard.
No skill was changed in response to them during this phase.

The custom metric pack passed all six coverage checks: complete matrix, 5/3
positive-negative mix, execution coverage, 8/8 completed processes, 8/8 usage
samples, and 8/8 semantic outcomes.

Observed total usage is lower than the previous baseline, but the runs include
different cache mixes and model variance. This report does not attribute that
difference to the P1 contract change.

## Evidence

- Positive results: `.plugin-eval/core-2.0.6-p1-contract-positive-result.json`.
- Boundary results: `.plugin-eval/core-2.0.6-p1-contract-boundary-result.json`.
- Destructive result: `.plugin-eval/core-2.0.6-p1-contract-destructive-result.json`.
- Consolidated usage: `.plugin-eval/core-2.0.6-p1-contract-usage.jsonl`.
- Static analysis: `.plugin-eval/core-2.0.6-p1-contract-static-analysis.json`.
- Observed analysis: `.plugin-eval/core-2.0.6-p1-contract-observed-analysis.json`.
- Structured scorecard: `benchmarks/results/latest.json`.

## Verification boundary

The phase 2 implementation passed the focused 15-test block, two independent
reviews returned zero findings, and the one full local suite passed 40/40 plus
the benchmark-wrapper, SDD-script, and Windows-release-tool checks. The four
held-out cases were prepared only in temporary test fixtures and never sent to
a model.
