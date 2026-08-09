---
name: design-ui
description: Turn visual intent into inspectable constraints, implement UI as one coherent system, verify the rendered result at real viewports, and review the resulting code structure against named depth red flags. Use when an interface looks generic or off, when a page/screen/dashboard is being built or redesigned, when a claim about design quality or fidelity needs proof, or when judging module boundaries and interfaces in UI code before merge.
---

# Design UI

Translate visual intent into inspectable constraints, then verify the rendered result. Do not substitute personal taste for the brief. Run intent capture before implementation, not as an after-the-fact review.

## 1. Capture intent as constraints

Inspect the existing application, dependencies, assets, copy, routes, screenshots, and user references before choosing an aesthetic. Record the intent in a plain file (markdown or JSON) kept outside the target repository — put it in the repo only if the user wants a versioned design spec. Record:

- **page kind**: marketing, product, dashboard, portfolio, commerce, editorial, or public-service;
- **mode**: greenfield, preserve, or overhaul;
- **audience**: the concrete primary audience;
- **direction**: desired visual or experiential qualities; **avoid**: explicitly rejected directions;
- **brand, content, and preserve constraints** as exact items; references; the existing component or design system;
- **dials**: variance (symmetry vs expressive composition), motion (static vs prominent movement), density (breathing room vs information per viewport), each 1–10. Dials are control signals guiding tradeoffs, never quality scores.

Missing page kind, audience, direction, or redesign preservation constraints mean you are not ready to implement: name the unresolved choices instead of guessing silently. Ask one focused question only when two materially different directions remain plausible; otherwise state one concise design read and proceed.

## 2. Choose context, not defaults

Use the existing stack and design system unless the user requested a replacement or it cannot satisfy the brief. Do not force React, Tailwind, dark mode, gradients, particular fonts, icon libraries, or animation packages. Before relying on a version-sensitive component, animation, or design-system API, check version-matched current docs (research-systematically).

**Greenfield:**

1. Anchor hierarchy in the user's primary task and real content.
2. Choose a layout family that suits page kind and density; do not default every page to a centered hero plus equal cards.
3. Define a small token set for typography, spacing, color, radius, and elevation before multiplying components.
4. Use one coherent icon and component language.
5. Introduce motion only where it clarifies hierarchy, continuity, feedback, or brand character.
6. Plan mobile composition rather than merely stacking desktop columns.
7. Use authentic supplied content and assets; mark missing media or copy instead of fabricating proof.

Anti-default observations are prompts to reconsider, not bans: a centered hero, purple palette, cards, serif type, glass, or dense dashboard can be correct when the brief supports it.

**Redesign — audit before editing:** route structure and navigation labels; real copy, legal text, forms, field names, interaction outcomes; brand assets, color and typography tokens, component system; representative desktop and mobile renders; existing loading, empty, error, disabled, and focused states. In preserve mode, modernize hierarchy, spacing, typography, responsive behavior, imagery, and motion without silently changing preserved behavior or content. In overhaul mode, larger visual changes are allowed, but every item on the preserve list stays fixed; document deliberate information-architecture or copy changes separately. A visual redesign never authorizes replacing the framework, rewriting unrelated business logic, changing routes, or installing a new component system. Verify existing and changed flows after each coherent boundary.

## 3. Implement coherently

Establish hierarchy, typography, spacing, color, shape, imagery, and motion as one system. Avoid repeated layout formulas or decorative elements that do not serve the content, but allow any pattern the brand or task explicitly supports.

Preserve real content. Never invent testimonials, customers, product metrics, certifications, screenshots, or operational state. Use supplied assets, generate authorized references, or mark missing assets clearly. Respect responsive behavior and existing functionality. Motion must express the intent and degrade coherently under a reduced-motion preference.

**Frontend performance (React/Next.js only)** — run a bounded static pass looking for: a Next.js root layout whose client boundary may be broader than necessary; raw `img` and `script` elements needing framework-aware replacement; large packages imported statically from client components. Every hit is a version-bound candidate, not a finding: confirm against version-matched docs, then measure the affected bundle, render, or network behavior before claiming an optimization. Valid exceptions are common.

## 4. Verify the render

Use real browser checks (automate-ui) to exercise relevant interactions and capture actual renders. Minimum: one mobile viewport at or below 480 CSS px and one desktop viewport at or above 1024 CSS px; add intermediate widths where layout behavior changes. A screenshot supports visual review but does not prove behavior.

Keep four evidence layers distinct — intent (what the design must express and preserve), render (screenshots tied to exact viewports and source state), review (named checks against those renders), behavioral (browser assertions for interactions) — and never merge them into one unsupported quality claim. For each capture, record the screenshot path, viewport, and what it shows.

Required checks, each marked pass / fail / not-evaluated with a concrete note:

- **brief-fidelity**: render matches audience, direction, and declared dials.
- **hierarchy**: primary task and information order are clear.
- **consistency**: typography, spacing, color, shape, imagery, and components form a system.
- **responsive**: composition remains intentional at every captured width.
- **content-integrity**: real content and preserved constraints were not silently changed or fabricated.

Add checks for motion, reduced motion, contrast, theme parity, loading states, or image fidelity only when relevant to the intent. A full pass means the declared review ran against specific renders at mobile and desktop with passing interaction checks — it does not prove universal accessibility, cross-browser behavior, production performance, or objective aesthetic quality. Taste stays subjective; say so.

## 5. Review the code structure

Judge structure by one currency: what it costs the next reader to change the code safely. Name the modules in scope as an explicit file list and read each completely, interface first, then body. Check the mechanical floor yourself (function length, nesting depth, parameter counts) and do not resell it as judgment. Report findings; never edit during the review — structural fixes belong to refactor-safely, completion audits to verify-work.

| Flag | Detect | Fix |
| --- | --- | --- |
| Shallow module | Public surface rivals body size; wrapper saves callers nothing | Deepen it, or inline the wrapper away |
| Information leakage | One decision (format, protocol, path rule) encoded in two+ places | Give the decision one owner module; others call it |
| Temporal decomposition | Structure mirrors execution order; step modules half-share a format | Reorganize around who knows what, not what runs when |
| Pass-through method | Forwards arguments unchanged; adds no contract, check, or translation | Remove the layer, or make it earn a real contract |
| Conjoined functions | Neither unit understandable without the other open | Merge, or re-split along a boundary each side can state alone |
| Comment restates code | Deleting it loses nothing a rename would not restore | Fix the name; keep only comments that carry why |
| Vague name | `data`, `info`, `handle`, `process`, or a name fitting several meanings | Rename for one meaning; a name that resists choosing means restructure |
| Non-obvious code | Reader needs an unstated fact: an ordering, a unit, an invariant | Make the fact visible in code, or state it where depended on |

For each public interface, weigh what a caller must learn against what the module does for them; flag any unit where learning the interface costs more than inlining the body would. Prefer one deeper module over several shallow ones; do not split merely for size when the pieces would share hidden state.

Report findings ordered by comprehension cost, each with file:line, flag name, observed symptom, cost in reader terms, and the named fix. Name what was reviewed and found clean, so a silent miss is distinguishable from an unchecked file.

## 6. Deliver honestly

Report the design read, preserved constraints, material visual changes, tested viewports and interactions, and remaining visual, behavioral, or structural gaps. For an independent release or quality verdict, use a fresh subagent or second independent context (verify-work) that sees the objective, diff, and evidence without being told the expected verdict. Use communicate-clearly for the final handoff.

## Pause points

DO-CONFIRM: work from judgment, then stop at each point and confirm every item. An unconfirmed item goes in the report, never silently past it.

**Before implementing**
- Visual intent recorded as inspectable constraints, not adjectives.
- Context chosen deliberately; defaults rejected or adopted by name.

**Before claiming fidelity**
- Rendered result verified at the declared viewports.
- Every quality claim maps to a recorded check, not an impression.

**Before reporting a structure review**
- Scope named as an explicit file list; each module read whole, interface before body.
- Findings ordered by comprehension cost; clean files named as checked.
- No code changed anywhere in the review.
