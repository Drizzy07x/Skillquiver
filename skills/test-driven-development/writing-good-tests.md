# Writing Good Tests

Load this reference when writing or changing non-trivial tests, mocks, fixtures,
or test-only helpers.

## Name the break

Before the test body, state the realistic production defect that should make
the test fail. A test earns its cost by catching a wrong branch, result,
argument, side effect, boundary case, or public contract.

- Derive expected values independently with literals or hand-checked fixtures.
  Do not call the production builder or repeat its algorithm on both sides.
- Test behavior that depends on a constant or message, not the private value or
  exact wording itself.
- Run scripts and assert outputs, exit codes, or side effects. Do not grep their
  source. Pressure-test agent instructions through representative behavior.
- Test the boundary your code owns, not documented framework mechanics.
- Skip trivial getters, constructors, forwarding, and constants unless they
  validate, normalize, default, derive, enforce, or cause a side effect.

Gate before writing:

```text
Name the production defect this test catches.
Cannot name one              -> redesign around observable behavior
Only source text changes     -> execute the artifact and assert effects
Only intentional redesigns  -> test the behavior that depends on the decision
Expectation reuses code logic -> replace with a literal or hand-checked fixture
```

## Exercise the real thing

Assert the real component's observable result. A mock assertion often proves
only that the mock exists.

- Run once against the real dependency to learn its side effects. Mock the
  slow, nondeterministic, privileged, or external operation below the behavior
  the test needs.
- Keep configuration writes, transformations, validation, and state changes
  real when they are part of the contract.
- Make doubles branch-specific and mirror the complete documented response
  shape. Assert arguments, ordering, or call count only when they are public
  behavior.
- Put cleanup used only by tests in test utilities, never production classes.
- Prefer an integration test with real components when mock setup is larger or
  harder to understand than the behavior under test.

Gate before adding a mock or helper:

```text
List the real dependency's side effects.
Keep contract-relevant effects real; mock only the unsafe/slow boundary.
Mirror the real response structure for success, error, and malformed cases.
If the assertion targets the mock itself, unmock it or test the real boundary.
If only tests call a helper, keep it in test code.
```

## Mutation check

Before finishing, mentally apply realistic mutations. At least one test should
fail for each applicable mutation:

- wrong argument, constant, or branch;
- missing side effect or state change;
- empty/default return;
- missing zero, empty, nil, malformed, or authorization handling;
- dependency error swallowed or mapped incorrectly.

A mutation nothing catches marks behavior as unprotected or the test as
tautological.

## Warning signs

- Setup and assertion share the same computed object.
- The test can fail only through a crash or missing selector.
- Expected values hide behind loops, builders, or production helpers.
- A removed symbol is asserted to remain absent.
- Partial mocks omit fields real consumers use.
- Test-only cleanup appears in production code.
- Mock setup dominates the test or no one can explain why the mock is needed.

Ship only tests that protect required behavior. A test written merely for
coverage or process adds maintenance without evidence.
