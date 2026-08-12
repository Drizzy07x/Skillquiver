---
name: design-ui
description: Turns visual intent into inspectable constraints, commits to a stated visual direction before writing code, implements UI as one coherent system, verifies the rendered result at real viewports, and reviews the resulting UI code structure for component-level red flags. Use when an interface looks generic, templated, or off, when a page/screen/dashboard is being built or redesigned, when palette, typography, or layout direction needs deciding, or when a claim about design quality or fidelity needs proof.
---

# Design UI

Translate visual intent into inspectable constraints, commit to a direction, implement one coherent system, and verify the rendered result. Taste never overrides the brief; every axis the brief leaves free is a decision owed.

## 1. Capture intent as constraints

Inspect the existing application, dependencies, assets, copy, routes, screenshots, and user references before choosing an aesthetic. Record intent in a plain Markdown or JSON file outside the target repository unless the user requests a versioned design specification:

- Page kind and mode: greenfield, preserve, or overhaul.
- Delivery target and hard limits such as network, build, size, or content-security constraints.
- Concrete primary audience, desired direction, and rejected directions.
- Exact brand, content, behavior, and preservation constraints; references; existing design system.
- Dials from 1–10 for variance, motion, and density. These guide tradeoffs rather than score quality.
- Free axes not pinned by the brief: palette, type, layout family, motion, tone, and imagery.

Ask one focused question only when two materially different directions remain plausible; otherwise state one concise design read and proceed.

Completion criterion: page kind, audience, direction, delivery limits, preserved constraints, and every free axis are explicit.

## 2. Choose context, not defaults

Use the existing stack and design system unless replacement was requested or they cannot satisfy the brief. Verify version-sensitive component, animation, and design-system APIs against current version-matched documentation.

For greenfield work:

1. Anchor hierarchy in the primary task and real content.
2. Select a layout family that expresses the content relationship and intended density.
3. Derive typography, spacing, color, radius, and elevation tokens before multiplying components.
4. Use one icon and component language; add motion only for hierarchy, continuity, feedback, or brand character.
5. Design mobile composition deliberately and mark missing content or media instead of fabricating proof.

For redesigns, audit routes, labels, copy, legal text, forms, interaction outcomes, assets, tokens, components, representative viewports, and non-happy states before editing. Preserve mode keeps behavior and content fixed. Overhaul mode permits larger visual changes but still requires explicit handling of every preserved item. A visual redesign does not authorize framework replacement, unrelated logic changes, route changes, or a new component system.

Common visual patterns are prompts to justify or replace, not bans.

Completion criterion: every reused or replaced convention is deliberate, and redesign scope preserves all declared behavior and content.

## 3. Commit to a direction before code

Before implementation, read [direction-plan.md](references/direction-plan.md) completely. Write its direction plan into the intent file and run its critique protocol.

The plan must resolve:

- Concrete palette and measured contrast roles.
- Type faces, roles, sizes, leading, tracking, and measure.
- Layout family, breakpoints, spacing ownership, radius, and desktop/mobile wireframes.
- Every page block in order, including designed `GAP: content` blocks.
- Every interaction's location, affordance, label, timing, and assistive semantics.
- One fully specified signature element that carries the design's distinctiveness.

Where the brief pins an axis, the brief wins. Skip critique only when it pins every axis. Record self-administered outcomes as claims; use `verify-work` for an independent rerun of consequential judgments.

Completion criterion: every field and plan-closure check in `direction-plan.md` passes after the final repair, and the intent file records what the critique changed.

## 4. Implement coherently

Build from the direction plan. Every color and type value traces to it; extensions are recorded before use, while silent contradictions are defects. Establish hierarchy, typography, spacing, color, shape, imagery, and motion as one system.

- Let the opening screen express the subject's actual thesis rather than a habitual hero formula.
- Spend boldness once on the signature and keep surrounding elements disciplined.
- Give each spacing and style decision one owner; avoid layered selector overrides.
- Remove one decorative element before declaring the composition finished and keep the stronger result.
- Preserve real content, assets, functionality, and responsive behavior.
- Make motion meaningful and provide coherent reduced-motion behavior.

When writing interface text, read [ui-copy.md](references/ui-copy.md). Labels, headings, and empty, error, loading, disabled, and success text are in scope; fabricated evidence is never in scope.

For React or Next.js only, run a bounded static pass for unnecessarily broad client boundaries, raw framework-sensitive media or scripts, and large static client imports. Treat hits as candidates: verify them against version-matched docs and measure before claiming an optimization.

Completion criterion: the implementation matches the final direction plan, preserves declared constraints, and contains no unrecorded design decisions.

## 5. Verify the render

Before viewing the first render, read [render-verification.md](references/render-verification.md) and freeze its checklist. Use `automate-ui` for real browser checks at mobile, desktop, and every meaningful intermediate width.

Keep intent, render, review, and behavioral evidence distinct. A screenshot never proves an interaction, and a statically opened artifact never supports a browser-behavior claim.

Completion criterion: every required and intent-specific check has an outcome tied to exact renders, every relevant interaction has behavioral evidence, and limitations and scope notes are explicit.

## 6. Review the UI code structure

Scope this pass to component boundaries, prop flow, and style tokens in files this workflow touched. Route generic pre-merge review to `requesting-code-review` and structural fixes to `refactor-safely`.

Name the files in scope and read each completely, interface first and then body. Review without editing:

| Flag | Detect | Fix |
| --- | --- | --- |
| Component boundary mismatch | One concept split across components that always change together, or unrelated concepts combined | Re-split along the design's real seams |
| Prop drilling as pass-through | Props cross layers that add no contract, check, or translation | Move state closer, compose children, or remove the layer |
| Style-token leakage | Raw values repeat where the direction plan owns a token | Route values through the token with one owner |

Report findings by comprehension cost with file:line, flag, symptom, reader cost, and named fix. Name clean files so unchecked scope is distinguishable from a clean result.

Completion criterion: the explicit file list was reviewed without edits and every checked file has either evidence-backed findings or a clean result.

## 7. Deliver honestly

Report the design read, direction plan, critique changes, preserved constraints, material visual changes, tested viewports and interactions, and every unresolved visual, behavioral, or structural gap. Give unresolved items the same prominence as resolved ones.

For an independent release or quality verdict, use `verify-work` with a fresh context that sees the objective, diff, and evidence without the expected conclusion. Use `communicate-clearly` for the handoff.

Completion criterion: every claim maps to recorded evidence, subjective judgments are labeled as such, and unresolved work is explicit.
