---
name: diagnose-systematically
description: Finds root causes through reproduction and falsifiable experiments. Use when a failure, flaky behavior, or regression lacks a demonstrated cause.
---

# Diagnose Systematically

Find the cause before proposing a fix. Diagnosis does not authorize implementation.

## Preserve evidence

Keep an append-only investigation log with the symptom, commands, exit codes,
decisive output, hypotheses, experiments, and verdicts. Put it in a scratch
directory unless the user requested a versioned artifact. If the user requests
read-only work or forbids edits, report that trail through command output and
the final response; do not create any file, including a scratch or temporary log.

## Evidence loop

1. **State the contract.** Name the involved components, their expected
   behavior, and the exact observed symptom. Verify environment assumptions
   such as build, branch, configuration, and dependency versions.
2. **Make it fail.** Run the smallest unattended signal that reaches the real
   symptom: focused test, CLI or HTTP assertion, headless UI check, trace
   replay, minimal harness, or seeded stress runner. A process starting, a
   string existing, or a silently skipped test is not a reproduction.
3. **Minimize.** Remove one input, dependency, configuration value, or step at
   a time. Keep a removal only when the same symptom remains. For intermittent
   defects, measure a reproduction rate instead of treating one pass as proof.
4. **Form falsifiable hypotheses.** First compare a working example of the same
   pattern with the failing path. Write only credible hypotheses, each with a
   distinguishing prediction and falsifier.
5. **Probe one variable.** Observe state at the earliest boundary where the
   predictions diverge. Revert probes or instrumentation that did not explain
   the symptom before trying the next one.
6. **Claim only what discriminates.** A cause is verified only when its
   prediction is observed through the symptom-specific signal and plausible
   alternatives are ruled out. Separate verified cause, inference, and
   proposed behavior change in the report.

A useful signal is symptom-specific, red-capable, deterministic or measured,
fast enough to repeat, and agent-runnable. If no such signal can be built,
report the attempts and request the smallest missing artifact or access.

## Scale the investigation deliberately

Keep one investigator for a small reproduced defect. Use parallel read-only
lanes only when several components remain plausible, the regression window is
uncertain, or intermittency supports independent probes. Give every lane the
same symptom packet and one seam: reproduction scope, first code-path
divergence, recent-change regression, or proof observability. Require a
hypothesis, prediction, falsifier, evidence, missing evidence, smallest next
probe, and confidence. Merge duplicate theories and run the cheapest
discriminating probe; ranking never proves a cause.

Use these resources only when their condition matches:

- Deep call-stack symptom: [root-cause-tracing.md](root-cause-tracing.md).
- Arbitrary delays or flaky async tests:
  [condition-based-waiting.md](condition-based-waiting.md).
- Test-order pollution: run [find-polluter.sh](find-polluter.sh).
- Proven source fix that needs layered guards:
  [defense-in-depth.md](defense-in-depth.md).

## Fix only when authorized

When the user requested a fix, turn the minimized reproduction into a
regression test at the highest public seam that exercises the defect. Record it
failing for the expected reason before changing production code. Implement the
smallest fix, rerun the identical test, then rerun the original unminimized
signal. Where cheap, revert the fix once to demonstrate the failure returns.

Do not substitute a shallow test when no correct seam exists; state the
limitation. Remove temporary instrumentation and harnesses. After three failed
fix attempts, stop and question the causal model or architecture instead of
stacking a fourth guess.

## Close

Report the supported cause, discriminating evidence, exact checks and results,
authorized fix if any, removed instrumentation, and unverified surfaces. Do not
call an unexplained recovery a fix.
