---
name: design-ui
description: Builds accessible interfaces and verifies renders. Use when creating or redesigning a page, dashboard, or static HTML file.
---

# Design UI

Translate the brief into explicit visual decisions, implement one coherent
system, and map every delivery claim to evidence.

## Route before any tool call

If the prompt names one existing framework-free HTML file and explicit
preservation constraints, the bounded path below is mandatory. Accessibility,
visual-quality, and responsive wording do not select the full workflow. Read
only through the bounded path, then act; do not load this skill's references or
continue into the full workflow. Use the full workflow for every other task.

## Bounded path for a small static page

Use this path when the request names one existing framework-free HTML file and
explicit preservation constraints:

This is a closed route. Do not enumerate the workspace, inspect version control
or package files, search for browsers, or reread this skill or the target for
confirmation. Visual, accessibility, or usability wording does not authorize
new product behavior; add JavaScript only when the prompt explicitly requests
an interaction. Do not probe the DOM, image pixels, or browser environment with
extra commands.

For this route, `focus` means the visible keyboard focus treatment and labeling
of the existing control. It never means implementing search, filtering, live
status, empty states, or other interaction. When the prompt requests no
interaction, the finished file must add no `script` element or event handler.

1. Read only that file and directly referenced local assets. Do not inspect
   package files, invoke other skills, or load this skill's references.
2. Before editing, send one sentence with this complete shape: `Direction:
   audience ...; layout ...; palette ...; typography ...; focus ...;
   responsive ...`. Do not edit until all six fields have concrete values.
   Preserve content and behavior; add no JavaScript or product behavior unless
   requested.
3. Apply one focused HTML/CSS patch. Preserve every named ID and constraint.
   Never delete the target file or replace it through a delete/add sequence.
   Make the 360px layout safe in the first patch: use border-box sizing, give
   grid or flex children `min-width: 0`, keep controls within `max-width: 100%`,
   and use a single-column flow below 480px. Put multi-column layout behind a
   `min-width` media query. At widths below 480px, use normal block flow with
   at least a 16px viewport gutter and borders instead of outer shadows. Do not
   use `100vw`, fixed or absolute positioning, transforms, decorative pseudo
   elements, grids, or flex containers there. Add only the visible label and,
   if needed, one short helper line; do not add badges, chips, eyebrow copy, or
   other content. Start from these shell invariants and keep their effect:
   `*,*::before,*::after{box-sizing:border-box}`, `body{margin:0;padding:16px}`,
   `main{width:100%;max-width:72rem;margin-inline:auto}`, and
   `input{display:block;width:100%;min-width:0;max-width:100%}`.
4. Run `node <this-skill-dir>/scripts/capture-static-page.cjs <page.html>
   <output-dir> <width...>` with every required width. It uses an already
   installed Chrome, Chromium, or Edge and installs nothing. Inspect each saved
   image at most once with the host image viewer, never with another command.
   For a capture below 480px, inspect only the returned `inspectionPath`; it
   centers the exact captured pixels on a wider canvas to avoid host-viewer
   cropping. Report the original `outputPath`, width, and height as evidence.
5. Report the returned image paths and dimensions. If it fails, stop and state
   that rendered verification is unavailable in the next response. Run no more
   commands after a failed capture. If the first captures expose a concrete
   defect, make one repair and repeat step 4 once. Run the capture command at
   most twice total. Do not repair, inspect, or recapture after the second run;
   issue the final response immediately even if a defect remains. A remaining
   defect at any required width means rendered verification failed; never call
   that width usable or the task complete.

For applications, multiple pages, uncertain behavior, or design-system work,
use the full workflow below. Accessibility and honest delivery apply to both.

## Full workflow

### 1. Record intent

Inspect the existing stack, routes, content, assets, dependencies, design
system, representative states, and user references. Record page kind
(greenfield, preserve, or overhaul), audience, delivery limits, required and
rejected directions, preserved behavior/content, and the brief's free axes:
palette, type, layout, motion, tone, and imagery. Keep the intent artifact
outside the repository unless the user requests a versioned design spec.

Ask one question only when two materially different directions remain equally
plausible. Otherwise state the design read and proceed. A visual redesign does
not authorize framework, route, logic, or content changes.

### 2. Commit to a direction

Read [direction-plan.md](references/direction-plan.md) completely. Before code,
record and critique concrete tokens, contrast, type roles, layout family,
breakpoints, spacing ownership, desktop/mobile wireframes, ordered blocks,
interactions, and one bounded signature element. Mark missing content rather
than fabricating it. The brief wins every conflict.

### 3. Implement one system

Use the existing stack and design system unless the request authorizes a
replacement or they cannot meet the brief. Verify version-sensitive APIs in
version-matched primary documentation.

- Trace every color, type, spacing, radius, elevation, and motion value to the
  direction plan; record an extension before using it.
- Preserve real content, assets, functionality, legal text, and responsive
  behavior.
- Use motion only for hierarchy, continuity, feedback, or brand character and
  provide reduced-motion behavior.
- Give each style decision one owner; avoid layered overrides and decorative
  competition with the signature.

When creating or changing interface text, read
[ui-copy.md](references/ui-copy.md). Include labels and empty, error, loading,
disabled, and success states; never invent evidence.

### 4. Verify the render and behavior

Before the first render, read
[render-verification.md](references/render-verification.md) and freeze its
checklist. Use the available browser automation at mobile, desktop, meaningful
intermediate widths, and relevant non-happy states. Check content presence,
layout, overflow, contrast, focus, keyboard and assistive semantics, motion,
and actual interactions.

Keep screenshots, behavioral evidence, code review, and subjective judgment
separate. A screenshot does not prove an interaction. If the environment lacks
a browser or required access, report the exact limitation instead of claiming
rendered verification.

### 5. Review touched UI structure

Read every touched UI file completely and review only component boundaries,
prop flow, and style-token ownership:

- Split or combine components along concepts that change together.
- Remove pass-through layers that add no contract, validation, or translation.
- Route repeated raw values through the direction plan's owning token.

Report actionable findings with exact file and line, reader cost, and named
fix; name clean files so reviewed scope is explicit. Route generic pre-merge
review to the repository's review workflow.

## Deliver honestly

Report the design read, preserved constraints, material changes, tested
viewports and interactions, evidence paths, structural review, and every
unresolved visual or behavioral gap. Label subjective judgments and give
limitations the same prominence as completed work.
