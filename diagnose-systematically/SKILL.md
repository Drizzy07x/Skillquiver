---
name: diagnose-systematically
description: Find the cause of a defect through observable evidence - build a runnable signal, reproduce, minimize, test falsifiable hypotheses one variable at a time, and prove any authorized fix red-to-green. Use when something fails, crashes, does nothing, slows down, or returns a wrong result and the cause is not already demonstrated, including intermittent or flaky defects and performance regressions.
---

# Diagnose Systematically

Find the cause through observable evidence. Preserve the request mode: diagnosis alone does not authorize a fix; implement one only when the user asked for it.

Keep an investigation log: a plain markdown file in a scratch directory, appended as work happens, never rewritten. Record the exact symptom, every command with exit code and decisive output lines, every hypothesis, every experiment and its verdict. Every rule below is checked against this log. If the investigation will span many turns or risks interruption, run it under execute-durably.

## Rules of engagement

Nine ordered rules govern every step:

1. **Understand the system first.** Name the components involved and what each is supposed to do before any theory exists. A cause claim about a component whose contract was never stated is unsupported.
2. **Make it fail.** A recorded reproduction command precedes every cause claim.
3. **Look before theorizing.** Capture actual state - logs, values, traces - before forming each hypothesis. Inferred state is not observed state.
4. **Divide and conquer.** Bisect the path from input to symptom; record each split and its verdict.
5. **Change one thing at a time.** One variable per experiment. A change that did not move the symptom is reverted before the next experiment starts.
6. **Keep an audit trail.** Every attempt, exact change, and observed result is written to the log as it happens. Memory of what was tried is not a trail.
7. **Check the plug.** Before suspecting code, verify environment assumptions: right build, right branch, config actually loaded, dependency versions as believed. List each checked fact.
8. **Get a fresh view.** When stalled, re-derive the picture from the recorded evidence alone, ignoring the current favorite theory - or hand the evidence to a fresh subagent without the theory attached.
9. **A fix is proven, not declared.** The original reproduction passes after the fix and, where cheap to show, fails again when the fix is reverted. An unexplained recovery is an unfixed defect.

## 1. Establish the signal

Read the relevant project guidance, callers, tests, logs, and the exact reported symptom. Build the smallest agent-runnable command that detects that symptom. Choose the cheapest signal that reaches the reported behavior, in order:

1. Focused unit, integration, or end-to-end test.
2. CLI or HTTP invocation with a known input and asserted output.
3. Headless UI flow with assertions on visible state, logs, or network behavior.
4. Replay of a captured request, trace, event stream, or dataset.
5. Minimal harness around the affected module.
6. Seeded property, fuzz, stress, differential, or bisection runner.

A useful signal is:

- **Symptom-specific:** fails for the behavior the user reported, not a nearby error.
- **Red-capable:** the defective state has actually produced a failing verdict.
- **Deterministic:** repeated runs agree, or an intermittent failure has a measured reproduction rate.
- **Tight:** setup and execution short enough to run after every meaningful probe.
- **Unattended:** the agent executes and interprets it without invented human observations.

An application starting, a command returning zero, a string existing in source, or a silently skipped test is not by itself a defect-specific signal.

Do not form a root-cause conclusion until the signal has reproduced the reported failure. If no viable signal can be built, report what was attempted and request the smallest missing artifact or environment access.

For a browser-visible symptom, use automate-ui to build or run the smallest user-visible reproduction and retain failure evidence: screenshot or artifact path plus what it shows. When the required path is unknown or an external interface has drifted, use it only to discover the flow, then return to a scripted symptom-specific signal.

## 2. Reproduce and minimize

Run the signal enough times to distinguish deterministic failure from intermittency. For a flaky defect, measure a reproduction rate and increase it with controlled stress, repetition, or timing changes.

Remove one input, dependency, configuration element, or step at a time. Keep a removal only when the same symptom still occurs. Stop when every remaining element is load-bearing.

When the search bisects instead of removing - halving the input, the commit range, or the path from input to symptom - record each split and its verdict as it happens. A bisection whose halves were not written down cannot show that the surviving half was the one the evidence chose.

## 3. Test hypotheses

Write up to five credible falsifiable hypotheses; never add filler to reach a quota. Give each a prediction and falsifier that distinguish it from the others. Probe one variable at a time, using a debugger or focused instrumentation at the boundary where predictions diverge.

Keep one investigator for a focused defect. After the symptom is reproduced, parallelize only when several components or plausible seams remain, the regression window is uncertain, or intermittency allows independent probes - and run the cheapest available discriminating probe first. Launch read-only lanes as fresh subagents, each given the same symptom packet and only its assigned question:

- **Reproduction scope:** establish the narrowest reliable trigger and impact boundary.
- **Code-path failure seam:** trace state and control flow to the first observable divergence.
- **Recent-change regression:** compare nearby history, contracts, flags, schemas, and dependencies.
- **Proof observability:** identify the smallest non-mutating command or existing evidence that distinguishes the leading hypotheses.

Require each lane to return: hypothesis, distinguishing prediction, falsifier, current evidence, missing evidence, smallest proof step, confidence. Merge findings yourself: treat identical causal theories as one hypothesis, keep the lowest confidence reported for it, and rank evidence-backed theories ahead of unsupported guesses. No ranking proves a cause - a ranked hypothesis becomes the supported cause only after its discriminating prediction is observed through the symptom-specific signal.

Do not parallelize a small reproduced defect with one likely seam. Do not launch lanes to reach a fixed reviewer count. Lanes stay read-only; the main agent owns reproduction, synthesis, instrumentation, fixes, and final claims.

After the signal is red, use solve-efficiently's project-navigation guidance when a code map can expose the call path or consumers around the failing boundary. Do not let exploration replace reproduction.

Tag temporary instrumentation with one unique marker so it can be removed deterministically. For performance regressions, capture a timing or profiler baseline before changing code.

## 4. Fix only when authorized

If the user requested a fix, convert the minimized reproduction into a regression test at the highest public seam that exercises the real failure. Run it and record it failing before touching source: exact command, exit code, decisive output lines. After the change, rerun the identical command and record it passing. A green run without a recorded prior red proves nothing.

If no correct test seam exists, state that limitation instead of adding a shallow test that cannot catch the defect.

## 5. Close with evidence

Re-run the original unminimized signal and the regression test. Where cheap to show, revert the fix and watch the original signal fail again: causality demonstrated in both directions, not inferred from one green run. Remove tagged instrumentation and throwaway harnesses. Report the supported cause, the discriminating evidence, the checks run, and any surface that remains unverified.

## Pause points

DO-CONFIRM: work from judgment, then stop at each point and confirm every item. An unconfirmed item goes in the report, never silently past it.

**Before forming hypotheses**
- Components named with their expected behavior.
- Environment assumptions checked and listed before code was suspected.
- Reproduction recorded; actual state captured, not inferred.

**During the investigation**
- One variable per experiment; unhelpful changes reverted.
- The audit trail written as it happens, not reconstructed after.
- Each bisection split and its verdict recorded before the next split.

**Before claiming the cause**
- The evidence discriminates the cause from the plausible alternatives.
- The original signal re-run; fix proven against it, not against the minimized copy only.
- Where cheap to show, the reverted fix made the original signal fail again.
- Instrumentation removed; unverified surfaces named.
