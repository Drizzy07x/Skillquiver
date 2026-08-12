# Skillquiver 2.0.2 final archive preflight

Date: 2026-08-12

## Outcome

Skillquiver Core 2.0.2 closes two final-directory defects found after the 2.0.1
benchmark gate:

- The generated short description used 44 characters while final directory
  submission permits at most 30.
- A diagnosis reference intended to report whether `API_KEY` was set could
  print the credential value and used `env | grep API_KEY`, which could also
  disclose it.

The 2.0.2 short description uses 26 characters. The diagnosis example now
reports only `SET` or `UNSET`, and a focused source test rejects both unsafe
forms. The rebuilt Core and its extracted upload archive pass the bundled
plugin validator.

This is a delta revalidation, not a claim that all eight Codex processes were
rerun. P2 was rerun because its diagnosis skill changed. The other seven
accepted scenarios retain byte-identical scenario skills from the 2.0.1 gate.

## Final metadata checks

The final directory rules published by OpenAI were checked against the rebuilt
manifest:

| Field | Observed | Final limit | Result |
| --- | ---: | ---: | --- |
| Package name | `skillquiver` | 64 characters and valid ASCII form | Pass |
| Version | `2.0.2` | Semantic version, at most 64 characters | Pass |
| Display name | 16 characters | 30 | Pass |
| Short description | 26 characters | 30 | Pass |
| Long description | 144 characters | 4,000 | Pass |
| Developer name | 9 characters | 80 | Pass |
| Capabilities | 2 | 20 | Pass |
| Starter prompts | 3 | 3 | Pass |
| Starter prompt lengths | 68, 68, 65 | 128 each | Pass |
| Starter prompt mentions | 0 | No `@mention` | Pass |
| Brand contrast against white | 3.35:1 | 2:1 | Pass |
| Logo | 512x512 PNG, 33,188 bytes | Square, 48–4,096px, at most 5 MiB | Pass |

`author.name` and `interface.developerName` match. The three prompts are unique
after whitespace and Unicode normalization. Both `logo` and `composerIcon`
resolve inside the package. The skills-only package contains no MCP, app, or
screenshot configuration.

## Archive checks

Artifact: `.plugin-eval/codex-core/skillquiver-2.0.2.zip`

SHA-256:
`611BA80422EA81CC57B11A0CA3C020A9C11713882AC298B15D04F59CA3517B62`

| Check | Observed | Portal limit | Result |
| --- | ---: | ---: | --- |
| Compressed size | 68,801 bytes | 100 MB | Pass |
| Archive entries | 34 | 5,000 | Pass |
| Extracted files | 21 | — | Pass |
| Extracted size | 101,671 bytes | 512 MiB | Pass |
| Largest file | 33,188 bytes | 100 MiB | Pass |
| Maximum path length | 57 characters | Supported path limit | Pass |
| Paths over 20 segments | 0 | 0 | Pass |
| Invalid or unsafe paths | 0 | 0 | Pass |
| Case or Unicode-normalized collisions | 0 | 0 | Pass |
| Source-to-extracted content differences | 0 | 0 | Pass |

The archive places `.codex-plugin`, `assets`, `LICENSE`, and `skills` directly
at its root. Entries use `/`, are relative, and contain no `..` segments or
outer whitespace. The extracted archive passed the bundled `plugin-creator`
validator.

## Security preflight

The final 21-file bundle was scanned for common API-key, GitHub-token, AWS-key,
and private-key signatures and for personal absolute paths. Matches: 0.

The diagnosis references were separately checked for the two unsafe credential
logging forms fixed in 2.0.2. Matches: 0. The remaining `API_KEY` examples show
only presence or absence.

The bundle includes two intentional local executables:

- `capture-static-page.cjs` invokes an installed Chrome, Chromium, or Edge
  executable with bounded screenshot arguments.
- `find-polluter.sh` runs the explicitly supplied test runner and reports which
  test creates an unwanted artifact; it does not delete the artifact.

## Delta benchmark

Only `skills/diagnose-systematically/root-cause-tracing.md` changed among the
six scenario skills after `v2.0.1`. `git diff --name-only v2.0.1` returned no
changes for `writing-plans`, `test-driven-development`,
`requesting-code-review`, `design-ui`, or `handle-host-boundaries`. Their seven
accepted scenario results therefore carry forward unchanged.

P2 was rerun against the rebuilt 2.0.2 Core:

- Process completed: 1/1.
- Semantic checks passed: 4/4.
- Workspace changes: 0.
- Duration: 52,484 ms.
- Input tokens: 59,864.
- Output tokens: 2,336.
- Total tokens: 62,200.

The response reproduced the supplied assertion, traced the empty-array path to
`0 / 0` and `NaN`, separated the verified cause from the proposed behavior
change, and edited no files. P2 used 2,846 fewer total tokens than its accepted
2.0.1 sample, a 4.4% decrease; one rerun does not establish a general usage
trend.

The consolidated eight-scenario scorecard contains the new P2 sample and seven
unchanged accepted samples:

- Processes completed: 8/8.
- Outcomes passed: 8/8.
- Checklist items passed: 29/29.
- Usage samples: 8/8.
- Input tokens: 533,920.
- Output tokens: 24,775.
- Total tokens: 558,695.
- Average total tokens: 69,836.88.
- Aggregate duration: 645,441 ms.

The clean 2.0.2 Core remains 86/100, grade B, under the comparable Windows
static profile. Trigger cost is 258 tokens, invoke cost is 5,756, active cost is
6,014, and deferred cost is 10,983. With the consolidated observed usage it is
72/100, grade C, high risk, with an observed-input estimate ratio of 10.1.

## Evidence

- P2 result: `.plugin-eval/core-2.0.2-p2-result.json`.
- P2 usage: `.plugin-eval/core-2.0.2-p2-usage.jsonl`.
- Consolidated usage: `.plugin-eval/core-2.0.2-final-usage.jsonl`.
- Clean static analysis: `.plugin-eval/core-2.0.2-static-windows-analysis.json`.
- Clean observed analysis: `.plugin-eval/core-2.0.2-final-clean-analysis.json`.
- Structured scorecard: `benchmarks/results/latest.json`.

## Repository verification

The final full-suite run passed every stage:

```text
$ bash tests/run.sh
tests 27
pass 27
fail 0
benchmark wrapper tests passed
SDD script tests passed
```

`git diff --check` also passed before the release commit.

## Remaining external gates

The final public publisher identity still must be aligned with the verified
Individual identity or a separately verified business identity. The archive
has not been transmitted to OpenAI Platform, so its portal scan, policy
attestations, review, approval, and publication remain unverified external
steps.
