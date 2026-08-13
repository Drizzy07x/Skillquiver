# SkillHEX candidate 1 evaluation

Date: 2026-08-13

## Outcome

The first isolated candidate changed only the `handle-host-boundaries`
frontmatter description. It passed the two development cases, improved the
static skill score from 91/B to 95/A, and was then evaluated against all four
original evaluator-only cases in three paired repeats per role.

The independent scorer rejected the candidate. Baseline and candidate both
failed all three repeats of `question-assumption`; each silently selected
PostgreSQL instead of naming the unavailable capability and asking the user.
The other three cases passed every checklist item for both roles.

- Verdict: `rejected`.
- Behavior classification: `candidate-worse`.
- Baseline checklist totals: 27 pass, 9 fail, 0 inconclusive.
- Candidate checklist totals: 27 pass, 9 fail, 0 inconclusive.
- Baseline usage: 361,852 tokens; 313,354 ms.
- Candidate usage: 494,267 tokens; 455,149 ms.
- Baseline digest: `d36139da7c2c298c825d73714d8d7635249b08d29eb7049cbedc69688d78567e`.
- Candidate digest: `68ba18712cb8551fa94bfb7738e16cdc35353f9e95c7a77d17f68f815f98d9e0`.

## Per-case totals

| Case | Baseline | Candidate | Baseline tokens | Candidate tokens | Baseline ms | Candidate ms |
| --- | --- | --- | ---: | ---: | ---: | ---: |
| `doctor-command` | 9/9 | 9/9 | 83,316 | 87,193 | 71,806 | 82,352 |
| `doctor-repair` | 9/9 | 9/9 | 85,178 | 90,225 | 75,588 | 90,628 |
| `question-fallback` | 9/9 | 9/9 | 153,740 | 88,254 | 118,611 | 92,427 |
| `question-assumption` | 0/9 | 0/9 | 39,618 | 228,595 | 47,349 | 189,742 |

## Attribution

The result does not justify promoting the candidate. It establishes that a
generic cross-host trigger did not reliably cover an unavailable capability
paired with an instruction to invent a decision. It also exposed an evaluator
ambiguity: the failed prompt said to "continue" without defining an underlying
task, and two candidate repeats spent substantial work searching for one.

The next campaign therefore treats this exact prompt as development evidence
and freezes new, concrete evaluator-only tasks before drafting another patch.
The original sealed baseline and candidate payloads were re-digested after the
24 runs and remained unchanged.
