# Direction Plan

Resolve the visual system before implementation. Write this plan into the
intent artifact, run the critique, repair it once, and build only from the
repaired version.

## Required decisions

Fill every field with concrete values. An adjective without a token, dimension,
or consequence leaves the decision to the implementer.

```text
## Direction

color
  surface: <hex, role>
  raised: <hex, role and boundary treatment>
  ink: <hex, contrast ratio on each ground>
  muted: <hex, contrast ratio on each ground>
  accent: <hex, semantic role and frequency>
  focus/border: <hex, 3:1 non-text contrast where perception is required>

type
  display: <family, weight, size range, line-height, tracking, reason>
  body: <family, weight, desktop/mobile size and leading, measure, reason>
  utility: <family, metrics, alignment, reason or explicit omission>

layout
  family: <named composition and content-based reason>
  widths: <mobile, breakpoints, desktop, max width>
  spacing: <token scale and owner for every step>
  shape/elevation: <tokens and roles>

inventory
  <ordered block>: <rank, content, state, preserved constraints>
  GAP: content: <designed slot and missing source>

interactions
  <action>: <location, affordance, label, timing, keyboard/assistive semantics>

signature
  what: <one element with geometry, tokens, and behavior at every width>
  why: <property of this subject that selects the element>
```

Measure text contrast at 4.5:1, or 3:1 for text at least 24 CSS px or
18.66 CSS px bold. Measure perceptible boundaries and focus indicators at 3:1.
Measure composited colors after blending; a proposed separator is not a remedy
until its rendered color passes.

Give each type role size, leading, tracking, and measure. Give each spacing
token one owner. Walk every rendered label, wordmark, placeholder, data value,
and internal gap so none inherits an accidental default.

List every page block in order, not only the opening screen. Mark unsupplied
content as `GAP: content` and design the slot without inventing its contents.
Select one signature element; specify its internal geometry, palette tokens,
responsive forms, motion, and reduced-motion behavior.

## Wireframes

Draw desktop and mobile compositions with inventory names and approximate
geometry. For each block, state what changes at every breakpoint. “Stacks” is
insufficient: preserve or replace the relationship the desktop layout encoded,
and state where hidden navigation or content moves.

```text
desktop 1280                    mobile 375
┌───────────────┬───────────┐   ┌──────────────┐
│ primary block │ detail    │   │ primary      │
├───────────────┴───────────┤   ├──────────────┤
│ signature                  │   │ detail       │
├───────────────────────────┤   ├──────────────┤
│ next named block           │   │ signature    │
└───────────────────────────┘   └──────────────┘
```

Every drawn fill, stroke, label, marker, and gap must resolve to a named token
or inventory decision.

## Critique gates

Record pass, failure, and repair for every gate. A self-review is a claim, not
independent evidence.

### 1. Subject substitution

For every rationale, name the subject property it depends on and substitute the
nearest different subject that shares that property. Use adversarial examples,
report every substitute considered, and mutate the substitute that nearly
failed the test.

If the same geometry works after changing only labels, the rationale is
generic. Revise or remove the decision. Prefer institutional or product facts
that constrain geometry over broad data shapes that transfer across domains.
When the brief names only a category, state that specificity ceiling and the
one missing fact that would raise it.

### 2. Default clusters

Identify category defaults and common generated patterns: centered hero plus
equal cards, bento grids, decorative sequence numbers, generic gradient SaaS,
dark surface with an arbitrary acid accent, editorial cream/serif/rust, or any
repeated sector layout. A match is allowed only with a reason grounded in the
brief, subject, or content hierarchy. “The category usually does the opposite”
explains a rejection, not the chosen replacement.

### 3. Free axes

For every free axis from the intent record, name the decision and classify its
reason as brief-pinned, subject-derived, downstream consequence, or bare
convention. Count bare conventions and replace any that also matches a default
cluster. Check ground color, radius, icons, and motion explicitly.

### 4. Concentration

Remove the signature: the page should lose its identity. Remove any other
decorative device: it should lose detail only. If two devices compete, visually
subordinate or remove one; renaming both as parts of the signature does not
resolve competition.

### 5. Arithmetic and consistency

Recompute every value the plan makes falsifiable:

- contrast ratios, composite colors, and boundary remedies;
- sample totals, percentages, units, dates, and derived geometry;
- `clamp()` values at declared widths;
- inventory counts and spacing ownership;
- token coverage for every wireframe element;
- longest labels and failure widths;
- signature dimensions and alternate forms.

Illustrative values must be visibly marked in pixels and in accessible names,
use fictional identifiers, and never attach invented state to a real entity.

## Plan closure

Close only when:

- every free axis, block, interaction, breakpoint, and preserved constraint is
  explicit;
- desktop and mobile wireframes agree with tokens and inventory;
- the signature is bounded and remains the sole identity-bearing device;
- contrast, formulas, counts, vocabulary widths, and sample state recompute;
- critique repairs tighten rather than silently loosen constraints;
- every repair has been checked against the complete gate set.

Record rejected directions and their reasons under `## Tried` so later work
does not converge on the same discarded default.
