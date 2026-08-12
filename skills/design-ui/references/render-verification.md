# Render Verification

Read this reference before inspecting the first rendered artifact. Freeze the checks before looking at screenshots or interacting with the UI.

## Evidence

Keep four evidence layers distinct:

- **Intent:** what the design must express and preserve.
- **Render:** screenshots tied to exact viewports and source state.
- **Review:** named checks evaluated against those renders.
- **Behavior:** browser assertions for interactions.

For every capture, record its path, viewport, source state, and what it demonstrates. A screenshot supports visual review but does not prove behavior. When the delivery target cannot be served, open the output directly and state that behavioral evidence is narrower.

## Freeze the checklist

Write the checks before viewing the render. Checks invented in response to the artifact make the verdict depend on reviewer time rather than a stable standard and penalize auditable work more than vague work.

Anything noticed outside the frozen list is a **scope note**: record it for the next round without lowering the current verdict. A failed verdict requires a defect that changes what a reader does or believes; “could be tighter” is a scope note.

## Required checks

Mark each pass, fail, or not-evaluated with a concrete note:

- **brief-fidelity:** audience, direction, dials, and preserved constraints match the intent.
- **hierarchy:** the primary task and information order are clear.
- **consistency:** typography, spacing, color, shape, imagery, and components form one system.
- **responsive:** composition remains intentional at every captured width.
- **content-integrity:** real content and preserved behavior were not silently changed or fabricated.
- **distinctiveness:** the signature exists in the render and remains the memorable element; every named default-cluster tell retains its recorded reason.
- **copy-quality:** actions keep one name, text is specific and active, and no fabricated evidence appears. Run [ui-copy.md](ui-copy.md) against the actual render.
- **contrast:** every declared text role, perceptible boundary, and composited value passes against the rendered colors rather than only the planned tokens.

Add motion, reduced-motion, theme-parity, loading-state, and image-fidelity checks only when the intent makes them relevant.

## Viewports and behavior

Use real browser checks through `automate-ui`. Capture at minimum:

- Mobile: at or below 480 CSS px; prefer 375x812.
- Desktop: at or above 1024 CSS px; prefer 1280x800.
- Every intermediate width where the direction plan changes composition or where a solved constraint approaches failure.

Exercise every relevant interaction and keep navigation evidence separate from behavioral proof. Verify reduced-motion behavior when motion exists.

## Claim boundary

A full pass means the declared checklist ran against specific mobile and desktop renders with passing relevant interaction checks. It does not prove universal accessibility, cross-browser behavior, production performance, or objective aesthetic quality. Distinctiveness is measured against the declared plan and named clusters; taste remains subjective.

Completion criterion: every required and intent-specific check has a recorded outcome against named renders, relevant interactions have behavioral evidence, and every limitation or scope note is explicit.
