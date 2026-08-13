# Applying SkillHEX to Skillquiver

Date: 2026-08-12
Source: [SkillHEX v1](https://arxiv.org/abs/2608.05628v1), submitted 2026-08-06
Status: phase 1 implemented; no candidate revision or held-out model run has been executed

## Recommendation

Adopt the paper's method as an **offline, benchmark-driven skill improvement loop**, not as runtime self-modification. The highest-value transfer is to turn each failed Skillquiver scenario into falsifiable failure hypotheses and reusable checks, preserve competing `SKILL.md` revisions instead of overwriting the first candidate, and spend fresh benchmark runs only on branches supported by accumulated evidence.

This is a strong fit for the repository's existing evaluation surface: the benchmark already defines five positive and three negative scenarios with explicit success checklists ([scenario matrix](../.plugin-eval/benchmark.json#L28-L123)), runs each scenario in a fresh workspace, retains raw artifacts, and separates process completion from outcome quality ([benchmark design](../benchmarks/README.md#L8-L16), [isolation and artifacts](../benchmarks/README.md#L40-L50)). The recorded 2.0.6 Core baseline passed 8/8 scenarios and 29/29 checklist items ([recorded gate](../benchmarks/results/2026-08-12-remediation-11.md#L7-L14)); the earlier 3/8 report remains useful only as historical evidence about failure attribution. P1's contract has since been tightened, so the full matrix has not been rerun against that updated prompt. This campaign reuses only the unchanged N1 and N3 evidence.

## Current baseline and phase 1 scope

The pilot targets `handle-host-boundaries`, the only current Core skill with a concrete weak-trigger warning. That warning is a hypothesis, not proof of a skill defect: the 2.0.6 N1 and N3 development cases both pass. The campaign therefore preserves two competing explanations: the description may fail on indirect host-boundary requests, or the evaluator warning may not predict observable routing behavior.

Phase 1 adds only offline experimental records and deterministic validation:

- [`host-boundaries.campaign.json`](../benchmarks/skillhex/host-boundaries.campaign.json) freezes the baseline, development/held-out split, competing hypotheses, hard gates, and three-valued evidence.
- [`baselines/host-boundaries-2.0.6.json`](../benchmarks/skillhex/baselines/host-boundaries-2.0.6.json) preserves the exact N1/N3 scorecard and source commit instead of following mutable `latest.json`.
- [`evaluator/host-boundaries.json`](../benchmarks/skillhex/evaluator/host-boundaries.json) defines four evaluator-only paraphrases, links each check to both competing hypotheses, and labels its evidence contract.
- [`campaign.cjs`](../benchmarks/skillhex/campaign.cjs) validates the linked campaign/evaluator records, rejects scorecards from another source commit, and replays existing results into `pass`, `fail`, or `inconclusive` evidence.

This phase does not generate patches, expose held-out cases to a candidate workspace, run a model, rank candidates, modify installed skills, or promote a revision.

## Mechanisms worth transferring

1. **Hypotheses with observable falsifiers.** SkillHEX represents each suspected defect with a description, predicted observable behavior, lifecycle state, and linked tests. Reflection may add, refine, or refute hypotheses rather than silently committing to one diagnosis ([paper section 3.1](https://arxiv.org/html/2608.05628v1#S3.SS1)). Skillquiver already teaches this discipline for individual debugging sessions ([diagnosis rules](../skills/diagnose-systematically/SKILL.md#L12-L24), [hypothesis protocol](../skills/diagnose-systematically/SKILL.md#L59-L74)); the improvement is to apply it to maintenance of the skill library itself.

2. **Validated tests plus retrospective replay.** The paper generates executable tests from active hypotheses, validates them, and records test results in an evidence matrix whose rows are skill revisions and columns are tests. A new test is replayed against cached outputs from all prior revisions, while a new revision is checked against all retained tests ([paper section 3.1](https://arxiv.org/html/2608.05628v1#S3.SS1)). Skillquiver already retains ignored run artifacts and extracts the newest valid terminal usage sample from them ([artifact policy](../.gitignore#L5-L10), [usage collector](../benchmarks/collect-usage.cjs#L32-L62)); those artifacts can also support cheap replay before another model run.

3. **Hard gates before semantic scoring.** SkillHEX gates semantic metrics on syntax, format, and other hard constraints, then backs up the best evidence found in a revision subtree ([paper section 3.2](https://arxiv.org/html/2608.05628v1#S3.SS2)). For Skillquiver, catalog and host-compatibility checks should be hard gates, negative safety scenarios must never be averaged away, semantic checklist performance comes next, and latency or tokens matter only among successful candidates. This matches the local outcome-gating rule ([benchmark review rule](../benchmarks/README.md#L53-L59)) and the existing manifest, host-boundary, scope, review, and UI regression checks ([catalog tests](../tests/catalog.test.cjs#L92-L176)).

4. **Persistent alternatives and exploration-aware selection.** The paper keeps every valid child revision, converts an ordinal reflection ranking into a prior, and uses a PUCT-style rule to revisit promising but underexplored siblings ([paper section 3.2](https://arxiv.org/html/2608.05628v1#S3.SS2)). This directly addresses the maintenance failure mode where an initially plausible wording change is refined repeatedly while a different explanation is never tried.

The paper reports 55.9% and 57.9% pass rates across 87 SkillsBench tasks under a five-iteration budget, 9.5 and 8.5 percentage points above its strongest baseline ([main results](https://arxiv.org/html/2608.05628v1#S4.SS2)). Its ablations report an 11.1-point drop without self-verification and a 6.8-point drop when the patch tree is replaced by in-place refinement ([ablation](https://arxiv.org/html/2608.05628v1#S4.SS3)). These results justify a local experiment; they do not establish a Skillquiver gain because the task suite, harness, backbones, and task-specific evolution setting differ.

## Reward-signal status

Do not feed historical outcomes directly into evolution. The two known prompt/rubric issues are now resolved in the current benchmark contract:

- **P1:** the prompt now explicitly says “Do not edit or create files,” matching its read-only checklist.
- **N3:** the prompt explicitly requests a plain-chat fallback when `AskUserQuestion` is unavailable.

Every remaining failure also needs causal triage before a skill patch is proposed:

- **Skill defect:** the aligned prompt, installed skill, and deterministic or independently reviewed semantic check reproduce the behavior. This is valid evolution reward.
- **Harness defect:** provisioning, sandboxing, fixture state, timeout, tool availability, or artifact capture caused the outcome. Fix the harness and rerun the same skill.
- **Evaluator defect:** the rubric is contradictory, hidden, unstable, or the scorer loses relevant evidence. Fix and freeze the evaluator before rerunning.
- **Orchestration defect:** a correct intermediate result is dropped or overwritten outside the target skill's substantive procedure. Test the target skill in a minimal single-agent path before editing it.

This distinction explained the historical 3/8 run, where orchestration, timeouts, and evaluator alignment affected several outcomes. It must still be applied to every future regression; a failed run is not proof that the corresponding `SKILL.md` is defective.

## Minimal Skillquiver pilot

Use one behavior cluster first: **host-boundary routing**. It has explicit development rubrics, four held-out paraphrases, and deterministic catalog constraints ([current constraints](../tests/catalog.test.cjs#L142-L166)). Do not combine it with review handoff in the same campaign.

1. **Freeze development and held-out cases.** Use N1 and N3 as development cases. Keep the four evaluator cases out of candidate staging, and do not change a rubric after seeing candidate output.
2. **Create a persistent campaign ledger outside the released plugin.** Each node records its ID, parent, affected skill, patch, hypothesis IDs, attributed failure layer, development run IDs, hard-gate results, checklist results, duration, tokens, and status. Keep candidate skill directories isolated; never overwrite `skills/` during search.
3. **Build the evidence bank.** Start columns with existing deterministic catalog checks and each scenario checklist item. Add a generated check only when it names its hypothesis, expected behavior, evidence source, and whether it is a hard contract or diagnostic proxy. Validate executable checks for syntax, bounded runtime, and a known positive/negative fixture before admitting them. Replay admitted checks over cached final messages, traces, and workspace diffs.
4. **Use three-valued local evidence.** Record `pass`, `fail`, or `inconclusive`, adapting the paper's binary matrix because local policy correctly treats timeouts, skipped checks, and missing logs as non-passes ([evidence standard](../skills/verify-work/SKILL.md#L23-L32)). Refuted hypotheses must remove or deactivate only their dependent diagnostic checks; stable contract checks remain.
5. **Preserve two competing branches.** Form two distinct causal hypotheses and create one single-cause patch for each. Run at most one fresh development attempt per branch after exhausting replayable checks. Rank them by: all hard gates pass; more development checklist items pass; fewer inconclusive items; then lower cost. Do not implement PUCT yet; first show that retaining the second branch can outperform committing to the first.
6. **Promote only on independent evidence and human approval.** Compare the winning candidate with the current skill using paired fresh runs, identical model/tools/fixture, randomized order, at least three repeats, and held-out cases. Score behavior before efficiency and compare cost only among successful pairs, as the repository already requires ([measured-improvement rule](../skills/verify-work/SKILL.md#L76-L81)). Run the full positive and negative matrix once at the end. Present the patch, hypotheses, and evidence for manual review; only the normal repository workflow may merge or publish it.

## What should not be copied directly

- **No runtime mutation of installed skills.** Skillquiver is a released cross-host instruction library. Unreviewed per-user evolution would make behavior irreproducible, split the supported hosts, and bypass catalog and safety gates.
- **No self-generated test as ground truth.** The paper explicitly recognizes that model-generated hypotheses and tests can be biased and prunes refuted evidence ([paper section 3.1](https://arxiv.org/html/2608.05628v1#S3.SS1)). Local semantic checks still need independent review, while hidden cases decide promotion.
- **No direct use of the paper's five-iteration budget.** The current eight valid Core samples consumed 875,361 total tokens ([usage report](../benchmarks/results/2026-08-12-remediation-11.md#L125-L131)). Start with replay and two fresh candidate nodes; expand only if the pilot shows a quality gain worth the cost.
- **No optimization against only the eight submission prompts.** Those cases are a release gate, not a training distribution. Repeatedly exposing their exact rubric to patch generation would reward benchmark wording rather than generally useful procedures.

## Decision gate

Phase 1 satisfies the immutable split and persistent-ledger requirements. Candidate generation remains blocked until isolated candidate staging and independent semantic scoring are implemented. The pilot succeeds only if a candidate beats the current skill on held-out paired runs without a safety or host-compatibility regression. Otherwise retain the current manual workflow; the paper's reported improvement is not transferable by assumption.
