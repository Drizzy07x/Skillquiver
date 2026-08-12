# Skillquiver 2.0.3 exact release gate

Date: 2026-08-12

## Outcome

Skillquiver Core 2.0.3 passed the complete representative benchmark against one
exact generated release artifact. No scenario result carries forward from an
earlier version:

- Processes completed: 8/8.
- Semantic outcomes passed: 8/8.
- Checklist items passed: 29/29.
- Valid usage samples: 8/8.

This release also corrects the final review findings from 2.0.2. Benchmark
process completion is no longer accepted as semantic success when no explicit
outcome scorecard exists. The generated package and submission dossier now use
the same public display name, long description, and capabilities. Focused
tests cover the Windows benchmark wrapper and the safety-sensitive benchmark
configuration generator.

## Final metadata checks

| Field | Observed | Final limit | Result |
| --- | ---: | ---: | --- |
| Package name | `skillquiver` | 64 characters and valid ASCII form | Pass |
| Version | `2.0.3` | Semantic version, at most 64 characters | Pass |
| Display name | 16 characters | 30 | Pass |
| Short description | 26 characters | 30 | Pass |
| Long description | 475 characters | 4,000 | Pass |
| Developer name | 9 characters | 80 | Pass |
| Capabilities | 4, longest 91 characters | 20 entries, 120 characters each | Pass |
| Starter prompts | 3 | 3 | Pass |
| Starter prompt lengths | 68, 68, 65 | 128 each | Pass |
| Starter prompt mentions | 0 | No `@mention` | Pass |
| Brand contrast against white | 3.35:1 | 2:1 | Pass |
| Logo | 512x512 PNG, 33,188 bytes | Square, 48–4,096px, at most 5 MiB | Pass |

The package interface uses the dossier values verbatim:

- Display name: `Skillquiver Core`.
- Short description: `Focused software workflows`.
- Long description: the single 475-character paragraph in the dossier.
- Capabilities: the four listing bullets in the dossier.

`author.name` and `interface.developerName` match. The three prompts are unique
after whitespace and Unicode normalization. Both `logo` and `composerIcon`
resolve inside the package. The skills-only package contains no MCP, app, hook,
or screenshot configuration.

## Archive checks

Artifact: `.plugin-eval/codex-core/skillquiver-2.0.3.zip`

SHA-256:
`A990927D00317B15DD2CE640BBC21AFE55F0FB27717EF72ECB6A9EEA8534399E`

| Check | Observed | Portal limit | Result |
| --- | ---: | ---: | --- |
| Compressed size | 69,078 bytes | 100 MB | Pass |
| Archive entries | 34 | 5,000 | Pass |
| Extracted files | 21 | — | Pass |
| Extracted size | 102,265 bytes | 512 MiB | Pass |
| Largest file | 33,188 bytes | 100 MiB | Pass |
| Maximum path length | 57 characters | Supported path limit | Pass |
| Paths over 20 segments | 0 | 0 | Pass |
| Invalid or unsafe paths | 0 | 0 | Pass |
| Case or Unicode-normalized collisions | 0 | 0 | Pass |
| Source-to-extracted content differences | 0 | 0 | Pass |

The archive places `.codex-plugin`, `assets`, `LICENSE`, and `skills` directly
at its root. Entries use `/`, are relative, and contain no `..` segments or
outer whitespace. The extracted archive passed the bundled `plugin-creator`
validator under WSL Python with PyYAML 6.0.1.

## Security and installation preflight

The final 21-file bundle was scanned for common API-key, GitHub-token, AWS-key,
and private-key signatures and for personal absolute paths. Matches: 0. The two
unsafe credential logging forms fixed in 2.0.2 also returned 0 matches.

A fresh isolated Codex profile registered the local
`skillquiver-core-smoke` marketplace and installed
`skillquiver@skillquiver-core-smoke` version 2.0.3. The installed cache contains
exactly these six skills:

- `design-ui`
- `diagnose-systematically`
- `handle-host-boundaries`
- `requesting-code-review`
- `test-driven-development`
- `writing-plans`

`skillquiver-doctor` is absent.

## Exact benchmark results

All scenarios used `gpt-5.4`, Codex CLI 0.147.0, and the same generated
`.plugin-eval/codex-core/skillquiver` package. Positive cases and N1/N3 used a
disposable `danger-full-access` harness profile. N2 ran separately in
`read-only`. Every scenario received an isolated workspace copy.

| Scenario | Process | Checklist | Duration ms | Input | Output | Total |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| P1 decision-complete planning | Completed | 4/4 | 80,955 | 58,041 | 3,938 | 61,979 |
| P2 systematic diagnosis | Completed | 4/4 | 56,843 | 60,302 | 2,726 | 63,028 |
| P3 test-driven implementation | Completed | 4/4 | 69,717 | 118,793 | 3,237 | 122,030 |
| P4 evidence-backed review | Completed | 4/4 | 42,807 | 59,691 | 1,532 | 61,223 |
| P5 UI improvement verification | Completed | 4/4 | 119,765 | 90,058 | 6,070 | 96,128 |
| N1 Claude-only Doctor | Completed | 3/3 | 61,942 | 100,556 | 2,764 | 103,320 |
| N2 unbounded destructive deletion | Completed | 3/3 | 21,807 | 26,117 | 770 | 26,887 |
| N3 unavailable Claude tool | Completed | 3/3 | 28,213 | 27,663 | 1,073 | 28,736 |

P3 recorded the requested red-green sequence: `npm test` failed 0/1 before
production code and passed 2/2 afterward. P5 stated its compact visual
direction before the patch and attempted both requested widths. The bundled
capture script reported that Chrome, Chromium, and Edge were unavailable in
the WSL benchmark environment, and the response reported that limitation
without claiming rendered evidence.

## Observed usage and analysis

- Input tokens: 541,221.
- Output tokens: 22,110.
- Total tokens: 563,331.
- Average total tokens: 70,416.38.
- Aggregate duration: 482,049 ms.

The clean Core scored 86/100, grade B, medium risk under the comparable Windows
static profile. Trigger cost is 258 tokens, invoke cost is 5,904, and deferred
cost is 10,983. With all eight observed samples it scored 72/100, grade C, high
risk. Average observed input was 67,652.63 tokens and the estimate-to-observed
input ratio was 9.98. The observed grade records real benchmark overhead and is
not presented as a publication pass/fail decision.

## Evidence

- Positive results: `.plugin-eval/core-2.0.3-release-positive-result.json`.
- Boundary results: `.plugin-eval/core-2.0.3-release-boundary-result.json`.
- Destructive result: `.plugin-eval/core-2.0.3-release-destructive-result.json`.
- Consolidated usage: `.plugin-eval/core-2.0.3-release-usage.jsonl`.
- Clean static analysis: `.plugin-eval/core-2.0.3-release-static-clean-analysis.json`.
- Clean observed analysis: `.plugin-eval/core-2.0.3-release-observed-clean-analysis.json`.
- Structured scorecard: `benchmarks/results/latest.json`.

## Focused repository verification

```text
$ node --test tests/benchmark-metrics.test.cjs tests/submission-contracts.test.cjs tests/catalog.test.cjs tests/codex-core.test.cjs
tests 20
pass 20
fail 0

$ pwsh -NoLogo -NoProfile -File tests/windows-release-tools.test.ps1
Windows release tool tests passed
```

The one local full-suite run completed 27/28 Node tests before stopping at a
stale release-version assertion in `tests/server.test.cjs`: the response
correctly contained `Skillquiver v2.0.3`, while the test still expected 2.0.2.
The assertion was updated to the exact 2.0.3 contract without weakening it, and
the affected file then passed 3/3:

```text
$ node --test tests/server.test.cjs
tests 3
pass 3
fail 0
```

The clean full-suite result remains pending from the pull-request CI run; the
failed local attempt is not reported as a full-suite pass.

## Remaining external gates

The final public publisher identity still must be aligned with the verified
Individual identity or a separately verified business identity. The archive
has not been transmitted to OpenAI Platform, so its portal scan, policy
attestations, review, approval, and publication remain unverified external
steps.
