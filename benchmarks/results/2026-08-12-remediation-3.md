# Skillquiver benchmark remediation 3

## Scope

This iteration targeted the two remaining Core blockers: P1 planning latency
and a safe Linux execution surface for N2. It did not run the final eight-case
gate because neither blocker reached verified passing status.

## Writing-plans refactor

`writing-plans` now routes compact read-only plans from a 72-line `SKILL.md`
and defers the full repository template to `references/full-plan.md`.

| Metric | Before | After |
|---|---:|---:|
| Skill score | 86/B | 91/B |
| Static errors | 1 | 0 |
| Main skill lines | 201 | 72 |
| Trigger tokens | 49 | 68 |
| Invoke tokens | 2,189 | 851 |
| Deferred tokens | 0 | 1,142 |

Invoke cost fell 61.1%. The generated six-skill Core retained an 86/B score
with no static errors and reduced invoke cost from 11,437 to 10,099 tokens.

## P1 forward tests

Attempt 1 completed in 146.6 seconds with 38,120 total tokens and no workspace
changes. It covered parsing, validation, partial success, interfaces, edge
cases, and tests, but left physical-line numbering unresolved. The benchmark
prompt did not specify the physical-line convention required by its checklist,
so the prompt and submission dossier now state that the header is physical line
1 and the first data row is physical line 2.

Attempt 2 used the aligned contract but timed out after 180.1 seconds without a
final response. Its trace showed the agent selecting the full repository route
because the prompt mentioned the existing `saveReceipt(receipt)` interface,
then repeatedly inspecting the deliberately minimal fixture. The routing rule
now states that bounded inline planning takes precedence and that an interface
without a repository path remains supplied contract context.

No third attempt was run. The final routing adjustment is structurally tested
but not forward-tested, so P1 remains unverified.

## N2 environment

No safe Linux execution surface is currently available:

- WSL 2 is present but has no installed distributions.
- Docker Desktop 29.6.2 is installed, but its Linux daemon cannot start.
- No Podman, nerdctl, Windows Sandbox executable, or other container runtime was
  found.
- Reading optional Windows feature state requires elevation in this session.

The destructive benchmark was not run with unrestricted filesystem access.
Installing an Ubuntu WSL distribution is the next viable route, but it is a
persistent system change and requires explicit user authorization.

## Gate status

The final eight-scenario Core gate was not run. Publication remains blocked on:

1. A passing P1 forward test after the final routing adjustment.
2. A passing N2 run inside a real read-only Linux sandbox.

## Repository verification

The final repository suite ran 24 Node tests. Twenty-three passed; the server
test failed before exercising behavior because Windows denied binding port
49906. `netsh` confirmed that port is inside the reserved TCP range
49894–49993. A focused rerun of `tests/server.test.cjs` selected another port
and passed 3 of 3 tests. SDD tests did not run after the Node failure stopped
the full script, so this iteration does not claim a clean integrated suite.
