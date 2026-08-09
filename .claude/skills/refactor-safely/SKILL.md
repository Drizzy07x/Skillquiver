---
name: refactor-safely
description: Refactor working code for readability and land changes in untested legacy code, without altering observable behavior - smell-driven moves, seams, dependency-breaking, and characterization tests. Use when tidying code that is messy, long, deeply nested, or duplicated, or when a change must land in uncovered code whose callers nobody can enumerate.
---

# Refactor Safely

Change how code reads without changing what it does, and land changes in untested code without breaking callers nobody can enumerate. solve-efficiently decides what to build; this skill governs how existing code is reshaped. Bug hunting belongs to diagnose-systematically.

## The non-negotiable rule

**Never change observable behavior while refactoring.** When no test covers the code, pin current behavior with a characterization test first, or state in the report that the change is unverified and why. Never put a behavior change and a refactor in the same commit.

## Pick the mode

- **Cleanup**: code works, reading it is painful, coverage exists or is cheap to pin. Follow Clean refactoring.
- **Legacy change**: a requested change must land where coverage is absent and behavior is defined only by what the code currently does. Follow the Legacy protocol - the net comes first, the change second. Clean up afterward inside the net, only if asked.

## Clean refactoring

1. **Scope.** Name the files in scope: those already touched this session plus their direct callers. Do not expand the blast radius.
2. **Measure before judging.** Read the code and record a baseline: function lengths, parameter counts, nesting depth, branch counts, file length, long lines, commented-out code, unresolved markers, duplication. Add what mechanical checks cannot see: wrong names, leaked abstractions, temporal coupling, boolean flag arguments, misplaced responsibility. If the repo records accepted violations, read the recorded reason before re-fixing what someone decided to keep.
3. **Rank by payoff.**

| Priority | Condition |
| --- | --- |
| P0 | Misleading name, or duplicated logic that already diverged |
| P1 | Function mixing decision + side effect + formatting |
| P2 | Nesting depth > 3, or function > 20 lines |
| P3 | Cosmetic: ordering, spacing, comment cleanup |

Fix P0 and P1. Fix P2 only where it makes P0 or P1 possible. Skip P3 unless a full pass was requested. State what you deliberately left alone and why; an honest "not worth it" is a valid deliverable.

4. **One transformation at a time**, each independently revertible, in this order: rename for intent; extract the deepest block into a named function; replace nested conditionals with early returns; collapse duplication only after the third occurrence and only when the copies encode the same decision; push side effects (I/O, logging, mutation) to the edges. Re-run the tests after each step; a red check reverts the step - never patch forward. Where no test exists, re-measure and diff the baseline.
5. **Name the smell, apply its move**, and report which move fixed which smell:

| Smell | Move |
| --- | --- |
| Long function - one name covering several jobs | Extract function per job |
| Feature envy - reads another module's data more than its own | Move the function to the data it envies |
| Shotgun surgery - one conceptual change touches many files | Gather the pieces into one owner |
| Data clumps - same values traveling together through signatures | Parameter object, or extract the hidden class |
| Primitive obsession - raw strings/numbers carrying domain rules | Value type that owns its rules |
| Divergent change - one module edited for unrelated reasons | Split by reason to change |
| Speculative generality - hooks or parameters no caller uses | Inline, collapse, or delete |

6. **Report**: changed files, before/after metrics, each move mapped to its smell, findings deliberately unfixed with reasons, and any behavior risk left unruled-out.

## Legacy protocol

1. **List the change points.** Exact functions, branches, and call sites the change must touch - written down, because every later step is scoped by it. Widening the list mid-change is a finding to report, not a silent expansion.
2. **Find the seams.** For each change point, the nearest place behavior can be observed or substituted without editing the code under change: a parameter carrying a test double, a constructor argument, an import boundary, an overridable method, a module boundary. No seam within reach goes in the report before any dependency is broken to create one.
3. **Break the dependency** with the smallest named move: **sprout method/class** - new behavior goes in a new tested unit the old code calls, old body barely touched; **wrap method** - the existing body keeps its behavior under a new name, the original name becomes a wrapper adding the new step; **extract interface / parameterize constructor** - a hard-wired collaborator becomes replaceable. Each move is mechanical and individually revertible. Do not redesign here - the goal is a sensing point, not better structure. Record which move opened which seam.
4. **Characterize current behavior, fail-first.** Assert a value you invented, run it, read the actual value from the failure output, pin the actual value, see it pass. The recorded value is the spec even when it looks wrong: a surprising output gets a report note, never a silent correction - changing it is a behavior change needing its own authorization. Cover every change point so an accidental shift turns a test red.
5. **Make the change** inside the net, landing it in the sprouted or wrapped units where possible, running the characterization suite after each coherent step. A red characterization test means the change altered something it was not authorized to alter: revert the step, never adjust the test.
6. **Verify preservation.** Full characterization suite plus pre-existing tests green, except tests the change was explicitly authorized to update - name each with its before and after value. Report the change points, seams and moves used, surprising behaviors recorded, and any surface left unprotected.

## Core rules

**Names.** State intent, not implementation or type: name the outcome (`publish_report`), not the mechanism (`build_json_and_post`). Searchability scales with scope - long names for wide scope, short ones inside two-line loops; `d`, `tmp`, `res` beyond that get renamed. No noise words (`data`, `info`, `manager`, `helper`, `util`, `process`). Same concept, same word everywhere; one word never covers two concepts; never disambiguate by number (`process1`). A name that needs a comment: the comment is the name. Booleans read as predicates (`is_ready`); void functions as commands (`save_invoice`).

**Functions.** One reason to exist; "and" in the name means split. Target under 20 lines; over 40 is a defect. One level of abstraction per body - never `calculate_tax()` beside `cursor.execute(...)`. Parameters: 0-2 fine, 3 suspicious, 4+ demands a parameter object or a split. No boolean flag parameters - that is two functions wearing one name. No output parameters: return a value instead of mutating an argument. Name plus parameters predict the return value - no hidden writes or network calls.

**Control flow.** Guard clauses first; happy path last and unindented; early return over nested `else`. Nesting past 3 means an extraction is overdue. Prefer `if is_valid` to `if not is_invalid`. A type switch repeated across the codebase becomes polymorphism or a dispatch table; one that appears exactly once can stay. Loops that build, filter, and transform at once: split into named steps or pipeline constructs.

**Duplication.** Two occurrences: leave it, note it. Three: extract, only if all three encode the same decision. Identical shape with different intent is not duplication - merging it creates a false abstraction that will need a flag parameter within a month, strictly worse than the copies. Prefer extracting a function over inheritance.

**Comments.** Keep: why a non-obvious choice was made, spec/ticket links behind workarounds, consequence warnings (`not thread-safe`, `O(n^2) by design, n < 50`), public API docs. Delete: prose restating the code (fix the name instead), change logs and author tags (version control owns those), commented-out code, markers with no owner and no ticket - file it or fix it.

**Errors and boundaries.** Exceptions, not error codes. Define error types by what the caller can do, not where they were thrown. Never return `null`/`None` as a signal when an empty collection or explicit result type exists; never pass `null` into a function you own. Catch what you can act on - an empty catch is a bug unless the component documents silence as its contract. Messages say what failed, with what input, and what to do next. Validate at the boundary, then trust the core. Wrap third-party APIs behind an interface you own so a vendor change touches one file. One exception, one log line, at the boundary.

**State and side effects.** Push I/O, clocks, randomness, and mutation to the edges; keep the core deterministic so it tests without mocks. Avoid temporal coupling (`init()` then `run()` then `close()`); mandatory order gets enforced by the type or a context manager. Prefer immutable values across function boundaries. Global mutable state is a defect with a delay fuse.

**Structure.** Public entry points first, details below in call order. Related things vertically close; unrelated things separated by distance.

**Tests.** Same naming and length rules as production code. One assertion concept per test; arrange/act/assert visibly separated. Names state behavior and condition (`returns_empty_list_when_no_matches`). No loops or conditionals in a test body; no shared mutable fixtures. A test needing five mocks indicts the design, not the test. Fast, independent, repeatable, self-validating.

## When not to refactor

Refuse, and say why, when: the code is stable, isolated, and unread - ugly and untouched beats clean and re-broken; it is generated, vendored, or an applied migration; there are no tests, no time to write them, and the change is cosmetic; the only justification is preference against an existing formatter or linter config - the config wins. If a refactor would change a published API or serialization format, stop and confirm first. Never rewrite a module wholesale when three targeted extractions do the job, and never introduce an abstraction with a single caller.

## Pause points

DO-CONFIRM: work from judgment, then stop at each point and confirm every item. An unconfirmed item goes in the report, never silently past it.

**Before touching code**
- Scope bounded to named files; baseline metrics captured.
- Legacy mode: change points listed explicitly; a seam identified per change point or its absence reported; only named moves planned, smallest first.
- Uncovered code has characterization tests pinned to observed output, each seen red then green - or the report will say the change is unverified. Surprising recorded behaviors noted, not corrected.
- Findings ranked; P3 cosmetics excluded unless a full pass was requested.

**After each step**
- Exactly one named move applied, independently revertible.
- Checks re-run; a red check reverted the step.

**Before claiming done**
- Behavior change and refactor never share a commit.
- Full suite green; every intentional test update named with before and after values.
- Report maps each move to its smell or seam, gives before/after metrics, lists deliberately unfixed findings with reasons, and names any unprotected surface.
