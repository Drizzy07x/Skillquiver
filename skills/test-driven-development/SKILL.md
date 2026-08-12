---
name: test-driven-development
description: Runs a recorded red-green-refactor cycle. Use when implementing a feature, bug fix, or behavior change.
---

# Test-Driven Development

Write one behavioral test, observe the expected failure, write the minimum code
to pass, and refactor only while green.

## Scope

Use TDD for features, bug fixes, and externally observable behavior changes.
For a pure behavior-preserving refactor, preserve existing green tests and add
coverage only for an uncovered contract the refactor could break. Ask before
skipping TDD for throwaway prototypes, generated code, or configuration-only
changes.

Production code written before its failing test is not a red-green cycle. Do
not keep it as a reference: revert that implementation, establish red, and
implement from the test.

## Cycle

### 1. Red

Write the smallest test that expresses one required behavior through the
highest practical public seam.

- Name the behavior precisely.
- Exercise real production code; mock only an external boundary that cannot be
  used safely or deterministically.
- Cover the requested example first, then one meaningful edge or error case.
- Run only the focused test while iterating.

Record the command, non-zero exit, and decisive assertion output. Confirm that
the test failed because the behavior is missing, not because of syntax, setup,
imports, or the wrong command. A passing test or a test that errors does not
establish red; correct it and rerun.

### 2. Green

Implement only enough production behavior to satisfy the red test. Do not add
options, abstractions, validation, or adjacent cleanup that no current test or
requirement demands.

Rerun the identical focused command. Fix production code rather than weakening
the assertion. Record the zero exit and passing output. If existing focused
tests now fail, resolve the regression before continuing.

### 3. Refactor

Only after green, remove duplication, improve names, or simplify structure
without adding behavior. Keep the focused tests green after every structural
change. If the next requirement needs new behavior, start another red cycle.

## Test integrity

Before writing or changing a non-trivial test, read
[writing-good-tests.md](writing-good-tests.md). In particular:

- Name the production defect that would make the test fail.
- Assert externally visible results, state, or calls at a real boundary rather
  than reimplementing the production algorithm in the test.
- Avoid tests that prove only a mock was configured.
- Keep test-only helpers out of production classes.
- Understand dependency side effects before replacing them.

Hard-to-test behavior is design feedback: simplify the public interface or
move dependencies behind an explicit seam. Huge setup should be reduced with a
small test helper before adding production abstraction.

## Completion

Before reporting success, verify and report:

- Every changed behavior has a test that was observed failing first for the
  expected reason.
- The implementation is the smallest one supported by the requirements and
  tests.
- Main examples plus proportionate edge and failure cases pass.
- The relevant test command passes with no hidden errors or warnings.
- No assertion was deleted or weakened merely to obtain green.

If red was not observed, say so explicitly; do not relabel tests-after as TDD.
