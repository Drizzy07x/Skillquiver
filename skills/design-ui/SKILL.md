---
name: design-ui
description: Turns visual intent into inspectable constraints, commits to a stated visual direction before writing code, implements UI as one coherent system, verifies the rendered result at real viewports, and reviews the resulting UI code structure for component-level red flags. Use when an interface looks generic, templated, or off, when a page/screen/dashboard is being built or redesigned, when palette, typography, or layout direction needs deciding, or when a claim about design quality or fidelity needs proof.
---

# Design UI

Translate visual intent into inspectable constraints, commit to a direction, then verify the rendered result. Run intent capture before implementation, not as an after-the-fact review.

Taste never overrides the brief. But every axis the brief leaves free is a decision owed, not a default to fall into — an unstated default is the most common cause of an interface that is coherent, responsive, honest, and still generic.

## 1. Capture intent as constraints

Inspect the existing application, dependencies, assets, copy, routes, screenshots, and user references before choosing an aesthetic. Record the intent in a plain file (markdown or JSON) kept outside the target repository — put it in the repo only if the user wants a versioned design spec. Record:

- **page kind**: marketing, product, dashboard, portfolio, commerce, editorial, or public-service;
- **mode**: greenfield, preserve, or overhaul;
- **delivery target**: existing application, static site, self-contained artifact, or component inside someone else's system — with its hard limits (no network, no build step, size ceiling, content-security policy). The target decides what section 2 may reuse and what section 5 can actually exercise;
- **audience**: the concrete primary audience;
- **direction**: desired visual or experiential qualities; **avoid**: explicitly rejected directions;
- **brand, content, and preserve constraints** as exact items; references; the existing component or design system;
- **dials**: variance (symmetry vs expressive composition), motion (static vs prominent movement), density (breathing room vs information per viewport), each 1–10. Dials are control signals guiding tradeoffs, never quality scores.
- **free axes**: the axes the brief does not pin — palette, type, layout family, motion, tone, imagery. Each becomes a decision owed in section 3.

Missing page kind, audience, direction, or redesign preservation constraints mean you are not ready to implement: name the unresolved choices instead of guessing silently. Ask one focused question only when two materially different directions remain plausible; otherwise state one concise design read and proceed.

## 2. Choose context, not defaults

Use the existing stack and design system unless the user requested a replacement or it cannot satisfy the brief. Do not force React, Tailwind, dark mode, gradients, particular fonts, icon libraries, or animation packages. Before relying on a version-sensitive component, animation, or design-system API, check version-matched current docs (research-systematically).

**Greenfield:**

1. Anchor hierarchy in the user's primary task and real content.
2. Choose a layout family that suits page kind and density; do not default every page to a centered hero plus equal cards.
3. Derive the token set for typography, spacing, color, radius, and elevation from the section 3 direction plan, before multiplying components.
4. Use one coherent icon and component language.
5. Introduce motion only where it clarifies hierarchy, continuity, feedback, or brand character.
6. Plan mobile composition rather than merely stacking desktop columns.
7. Use authentic supplied content and assets; mark missing media or copy instead of fabricating proof.

Anti-default observations are prompts to reconsider, not bans: a centered hero, purple palette, cards, serif type, glass, or dense dashboard can be correct when the brief supports it. Section 3 is where each of those is either justified or replaced.

**Redesign — audit before editing:** route structure and navigation labels; real copy, legal text, forms, field names, interaction outcomes; brand assets, color and typography tokens, component system; representative desktop and mobile renders; existing loading, empty, error, disabled, and focused states. In preserve mode, modernize hierarchy, spacing, typography, responsive behavior, imagery, and motion without silently changing preserved behavior or content. In overhaul mode, larger visual changes are allowed, but every item on the preserve list stays fixed; document deliberate information-architecture or copy changes separately. A visual redesign never authorizes replacing the framework, rewriting unrelated business logic, changing routes, or installing a new component system. Verify existing and changed flows after each coherent boundary.

## 3. Commit to a direction before code

Write a direction plan into the same intent file, critique it, and only then build. Load `references/direction-plan.md` for the field template, the named default clusters, ASCII wireframe conventions, and the critique protocol. The plan states four things:

- **color**: 4–6 named values with hex and role, including which one carries the accent and how often it may appear. "A warm neutral palette" is not a value. Every value that carries text states its measured contrast ratio against the ground it sits on; a text role under 4.5:1 — 3:1 at 24px or 18.66px bold — is a defect in the plan, not something section 5 discovers after the palette is locked. The same measurement covers every boundary a reader must perceive at the 3:1 non-text threshold — including the vertical edges of a surface, not only the horizontal ones — and every value produced by compositing: a rule at 12% over the ground is a new colour, so measure the composite, never its source. Every colour appearing anywhere on the page is in this table, including colours used only inside the signature; a fill the wireframe draws and the palette does not name is an unmade decision.
- **type**: a face per role — display, body, and a utility face when the content has data or captions — each with a one-line rationale tying it to this subject, plus the scale: size and leading for every role at both widths, or the clamp spanning them. Typography carries the personality; a rationale that fits any subject is not one, and a face with no size is not a decision — the developer will pick one for you.
- **layout**: the layout family, the relationship in the content that makes it the right family, an ASCII wireframe at desktop and mobile, and the values a developer would otherwise invent: breakpoints, content measure, spacing scale, and radius. Every breakpoint carries a stated consequence or is deleted, and the spacing scale says which step owns which role — eight numbers with no owners is a scale nobody can apply.
- **inventory**: every block the page contains, in order, each with a name, its rank, and the one thing it holds. A region labelled `BLOCK 2` is an unresolved decision wearing a wireframe's clothes. Blocks whose *content* the brief cannot supply are still designed and marked `GAP: content` — form, rank, and composition are the designer's to decide, and a missing price does not excuse an unplanned pricing block. `GAP` never licenses skipping a block; a plan that resolves the hero beautifully and leaves the rest unnamed is a direction, not a page. Nor does elision: "…and ten more rows" is a gap without the marker. Every interaction the page contains is specified here too — where it lives, its affordance and label, its timing, and its keyboard and assistive semantics.
- **signature**: the single element the interface is remembered by, stated as what and why — plus its full specification: dimensions, the palette tokens it uses, its behaviour, and how it is bounded at every width, including the width band where it changes form. The one element that must not be left to improvisation is the one the page is remembered by.

  **Its complexity is capped by your ability to specify it.** If the internal layers do not sum to the stated height, if a form below some width exists as one sentence, if a mark's stroke does not scale with the mark, the signature is more elaborate than the plan can carry — and an implementer will finish it from habit, which is where the defaults return. A simple device specified completely beats an elaborate one specified to sixty percent. Cut the third mark rather than ship it undrawn.

  **A repair pass regresses what it does not re-measure.** Fixing a named defect changes the system around it: give a mark a new meaning and the legend that named the old one becomes false; move a breakpoint to recover width and the measure inverts somewhere else. So a repair is not complete when the punch list is empty — it is complete when the *whole* check set has been re-run against the repaired artifact. Measure every dimension after every pass, not the ones you touched, and be willing to conclude that the previous version was better and keep it.

  **These checks trade against each other, so choose the axis deliberately.** They are not independent scores to maximise at once. Computing a real model buys subject specificity and costs concentration and honesty — a model needs controls, states, a legend, and it tempts you into asserting domain rules you were never given. Cutting scope buys concentration and costs specificity, because what survives is the generic skeleton. Adding an interaction buys the answer and costs the no-script baseline. Name which axis this brief actually prioritises, spend there, and when you add a capability, re-run the checks that capability will cost rather than the ones it improves. A plan that reports itself strong on every axis has usually measured each in isolation.

  **The cap is on the whole plan, not only the signature.** A plan has a finite specification budget, and the checks in section 3 all draw on it. Adding a lane, a form, a block, or a device costs the budget that the wireframe plot, the vocabulary solves, the token enumeration, and the prohibition walk need — and the shortfall does not announce itself, it shows up as an unassigned type role, a drawing that drifts off its own scale, a control nobody specified. When a check starts failing on the old parts while the new parts pass, the plan is over budget: cut scope until every check closes on everything, and cut it before adding the next idea. Ambition the plan cannot specify is ambition the implementer resolves from habit.

Then critique the plan before writing code, and record the outcome:

1. **Substitution test** — for each reason, name the property of the subject it depends on, then hunt for a subject that has that property. Choose substitutes adversarially: the set must contain the nearest subject you can construct that satisfies the reason, not the most convenient one. Every substitute raised anywhere gets a reported result — one named and left unresolved is a failed gate, not an omission. A reason that survives any substitute in the set has failed; revise it or delete the decision it was defending. And a distinguishing property that changes no pixel is a story, not a reason: if the plan renders identically whether or not the property holds, the property is not selecting the design. When a substitute *is* defeated by a property you named, mutate that same substitute to remove the property and test the variant — escapes are usually one mutation deep, and the subject you already circled is where the real defeat lives. Blocks carried over as page-kind furniture are named as such rather than left silently untested.
2. **Cluster check** — walk the tells individually, not the looks as wholes: a plan can hold two tells of a cluster while matching none of it overall, and two is enough for a viewer to place it. Extend the named table with the page kind's own category defaults for this run; the list is evidence, not an inventory, and it covers decoration only. The loudest category default is **structural**: the block skeleton itself — masthead, hero, proof, how-it-works, pricing, trust, repeated call to action, FAQ, footer — is the sector's stock page, and adopting it whole is a decision owed a reason like any other. Its **order** is part of it, and a sequence nobody chose is a sequence inherited. Count departures by slot, not by item: dropping testimonials, logos, ratings, and a screenshot gallery is one slot vacated, not four blocks cut. Matching a tell is allowed; matching one without a stated reason is not — and every decision gets checked, including the layout family, not only the decisions that resemble a table row.
3. **Free-axis check** — every free axis from section 1 resolves to a stated decision *and* to the kind of reason behind it: brief-pinned, subject-derived, downstream consequence of another decision, or bare convention. An axis resolved with no reason of any kind is an unstated default — radius, ground, and iconography are where they hide. Count the bare-convention ones and cross-check them against gate 2: **a value held by bare convention that also sits on a cluster tell must be derived or moved.** Withdrawing a reason you cannot defend is honest and leaves the pixel exactly where it was; converting "a bad reason" into "no reason" resolves the record, not the design. No decision or dial rests on a design read the plan elsewhere flags as unconfirmed without saying so at the point of use.
4. **Concentration check** — test by removal, not by definition, **at every declared width**. Remove the signature: the page should lose its identity. Remove each other candidate device: the page should lose detail only. Rank candidates by drawn area at each width rather than by an unstated sense of loudness — a secondary device repeated fifteen times is larger than the signature even when each instance is smaller, and a page whose signature owns 22% of the mobile viewport while a supporting strip owns 69% has its concentration inverted exactly where the audience reads it. Any device that survives the signature's removal and outmeasures it at any width is a competitor. Declaring a second device to be "part of" the signature resolves nothing — subordinate it visually or cut it.
5. **Consistency check** — the plan's own numbers have to hold. Sample figures sum to their stated total and their percentages to 100; a clamp produces the values the type table claims at the widths it names; a token exists for every element that renders. Counts are only checkable when the list is present, so publish the enumeration rather than the total — "eighteen elements, all tokened" with no eighteen named is an assertion, not a count. And every prohibition the plan declares is checked against the geometry the plan draws, not against the record of what the critique changed: a tell the plan believes it deleted is still a tell if the wireframe still draws it. A thesis illustrated by figures that do not add up is a thesis the plan has not tested once.

**The specimen must be a state the product would actually produce, and its copy must be the copy that state produces.** A drawing is a worked example of the thing working, so read it back as a user would: does the geometry say what the words say? A bar that begins two hours in the future under a caption reading "open until" is the demonstration showing the product answering wrongly — and it survives every other check, because the palette is measured, the parts sum, the marks are plotted, and the string is a declared member of a declared vocabulary. It is simply the wrong member for the state drawn. Pick the string from the geometry, not from the vocabulary's first row, and check every form against its own drawing.

**Factual claims in the copy are numbers too.** A sentence the page states about the world — a range, a frequency, a rule about how something behaves — is checkable, and writing it inside a document that says everything was computed does not make it computed. Either derive it or cut it to what you can derive. A heading that asserts what the product does is the same class of claim as a compliance badge, and it belongs in the fabrication column, not in prose that escaped the check because it had no digits.

**Verify ranges, not endpoints.** Checking a layout at 375 and at 1280 and asserting the band between is how a plan ships a collision at 768. For every constraint with a width-dependent term, solve for the width at which it fails and compare that against the breakpoint that is supposed to prevent it. A stated bound — "unchanged from 640 to 1199" — is a claim with an arithmetic answer, and the answer is often that the rule needed to fire 260px earlier. **Solve against the longest member of the declared vocabulary, not the string the sample happens to use**: a column sized on "Suspended" collides on "No window today", and the breakpoint fires late by exactly the difference.

**Plot the wireframe; do not sketch it.** The drawing is the plan's proof that the geometry works, so its positions are computed from the declared geometry — origin, scale, and every mark's offset — not placed by eye. A sketch that puts the present-time marker at 52% of an axis whose origin puts it at 6% has disproved the plan rather than illustrated it, and every prohibition walked against that drawing was walked against fiction.

**Re-verify derivation chains against the final values.** A chain licenses a decision — "the accent must be the highest-luminance mark, therefore this hue, therefore a dark ground" — and then later gates change the values it was written for. Recompute the premise against what actually ships: if the body text ends up brighter than the accent, the chain is false and everything downstream of it reverts to bare convention. **And unit-check every derivation**: a quantity per lunar day divided into minutes per solar day yields lunar days, not solar days, and the answer will be wrong by a day while looking right.

A critique may only tighten. If a gate's outcome is that a constraint disappears — a cap removed, a limit relaxed, an exception granted — record it as a loosening and re-run gate 4, because concentration is exactly what caps protect. A critique whose net effect is fewer constraints and more specification has bought precision with discipline.

These gates are self-administered. Record each outcome as a claim, never as proof — an author is the worst available judge of whether their own reason is subject-specific, and the usual failure is accepting a reason that in fact transfers. Before the plan is built from, a second independent context re-runs the substitution test on the retained reasons without being told what the first pass concluded (verify-work). Independent re-runs routinely reverse a gate the author passed, and the reversals are the point. If no second context is available, say plainly that gate 1 carries no independent evidence — do not let a self-passed gate stand in for one that was tested. Independence relocates the bias rather than removing it: the author still chooses which substitutes to raise and which results to report, so the adversarial-selection and report-everything rules in gate 1 hold for the independent run too.

Where the brief pins an axis, the brief wins outright — including when it asks by name for a look the reference file lists as a common default. Skip the critique only when the brief pins every axis.

## 4. Implement coherently

Establish hierarchy, typography, spacing, color, shape, imagery, and motion as one system. Build from the direction plan: every color and type value traces to it. Extending the plan is expected; contradicting it silently is a defect. Avoid repeated layout formulas or decorative elements that do not serve the content, but allow any pattern the brand or task explicitly supports.

**Opening move** — the first screen states the thesis: the most characteristic thing in the subject's world, in whatever form that subject calls for. A large metric with a small label, supporting stats, and a gradient accent is the default answer; use it only when it is genuinely the best one.

**Spend boldness once** — the signature element carries the risk and everything around it stays disciplined. Match execution to the direction: expressive directions need elaborate detail, restrained ones need precision in spacing and type. Before declaring done, remove one decorative element and check whether the result improved.

**Craft pitfalls** — watch CSS selector specificity where section-level and element-level rules meet; a `.section` rule and a `.cta` rule silently cancelling each other's spacing is the common failure. Give each spacing decision one owner instead of layering overrides.

**Copy** — when the brief supplies no copy, write it; generic copy reads as templated as generic layout. Load `references/ui-copy.md`. Writing labels, headings, and empty, error, loading, and disabled text is in scope in every mode. Fabricating evidence is out of scope in every mode.

Preserve real content. Never invent testimonials, customers, product metrics, certifications, screenshots, or operational state. Use supplied assets, generate authorized references, or mark missing assets clearly. Respect responsive behavior and existing functionality. Motion must express the intent and degrade coherently under a reduced-motion preference.

**Frontend performance** — only if the stack is React/Next.js, additionally run a bounded static pass looking for: a Next.js root layout whose client boundary may be broader than necessary; raw `img` and `script` elements needing framework-aware replacement; large packages imported statically from client components. Every hit is a version-bound candidate, not a finding: confirm against version-matched docs, then measure the affected bundle, render, or network behavior before claiming an optimization. Valid exceptions are common.

## 5. Verify the render

Use real browser checks (automate-ui) to exercise relevant interactions and capture actual renders. If the host's browser capability can resize the viewport, use its mobile (375x812) and desktop (1280x800) presets — or explicit width/height for intermediate widths. In Claude Code, `mcp__Claude_Browser__resize_window` is one example. Minimum: one mobile viewport at or below 480 CSS px and one desktop viewport at or above 1024 CSS px; add intermediate widths where layout behavior changes. A screenshot supports visual review but does not prove behavior.

When the delivery target cannot be served — a self-contained file, a component with no host application, an environment with no runnable build — open the rendered output directly and record that behavioral evidence is correspondingly narrower. Opening a file statically never upgrades into an interaction claim.

Keep four evidence layers distinct — intent (what the design must express and preserve), render (screenshots tied to exact viewports and source state), review (named checks against those renders), behavioral (browser assertions for interactions) — and never merge them into one unsupported quality claim. For each capture, record the screenshot path, viewport, and what it shows.

**Fix the check list before you look at the render.** A review that invents checks in response to what the artifact happens to expose measures the reviewer's diligence and budget, not the work: every check that passes frees attention to look somewhere new, and somewhere new always yields something. Two consequences follow, and both bite. A verdict of "nothing left to name" is a claim that a search terminated, which is unfalsifiable in the reviewer's favour and embarrassing if a peer finds something — so an open-ended standard has a fixed point one notch below its own top, and no artifact can climb past it. And the standard runs backwards: an artifact that publishes its measurements, ships an executable model, and enumerates its own states hands the reviewer material to falsify, while a vaguer one offers nothing to name and reviews better. Naming the checks in advance is what stops the review from punishing the work for being auditable.

So: write the checks down first. Anything you notice outside that list is a **scope note** — record it, add it to the list for the next round, and do not let it lower this round's verdict. Reserve a failed verdict for a defect that changes what a reader does or believes; "could be tighter" is a scope note.

Required checks, each marked pass / fail / not-evaluated with a concrete note:

- **brief-fidelity**: render matches audience, direction, and declared dials.
- **hierarchy**: primary task and information order are clear.
- **consistency**: typography, spacing, color, shape, imagery, and components form a system.
- **responsive**: composition remains intentional at every captured width.
- **content-integrity**: real content and preserved constraints were not silently changed or fabricated.
- **distinctiveness**: the signature element exists in the render and reads as the memorable one; every part matching a named default cluster carries the reason recorded in section 3.
- **copy-quality**: interface text is specific and active, each action keeps one name across its flow, and no fabricated evidence appears. Run the checklist in `references/ui-copy.md`.

Contrast is a required check whenever the direction plan declared text roles, measured against the rendered values — overlays, opacity, and inherited color move them away from the planned ones. Add checks for motion, reduced motion, theme parity, loading states, or image fidelity only when relevant to the intent. A full pass means the declared review ran against specific renders at mobile and desktop with passing interaction checks — it does not prove universal accessibility, cross-browser behavior, production performance, or objective aesthetic quality. Distinctiveness is a check against the declared plan and the named clusters, not a claim that the result is good. Taste stays subjective; say so.

## 6. Review the UI code structure

This pass covers UI-specific structure only — component boundaries, prop flow, and style tokens in the code this skill produced or touched. Generic pre-merge code review routes to requesting-code-review; broader structural cleanup to refactor-safely. Name the components in scope as an explicit file list and read each completely, interface (props) first, then body. Report findings; never edit during the review — structural fixes belong to refactor-safely, completion audits to verify-work.

| Flag | Detect | Fix |
| --- | --- | --- |
| Component boundary mismatch | One visual concept split across components that always change together, or one component rendering several unrelated concepts | Re-split along the seams the design actually has |
| Prop drilling as pass-through | Props forwarded unchanged through layers that add no contract, check, or translation | Move state closer to its use, compose children in, or remove the layer |
| Style-token leakage | Raw color, spacing, or type values repeated where the direction plan's token set already owns them | Route every such value through the token; one owner per design decision |

Report findings ordered by comprehension cost, each with file:line, flag name, observed symptom, cost in reader terms, and the named fix. Name what was reviewed and found clean, so a silent miss is distinguishable from an unchecked file.

## 7. Deliver honestly

Give the unresolved items the same prominence as the resolved ones — a report that documents its own rigor at length while burying what it could not settle has bought credibility rather than earned it. Report the design read, the direction plan and what the critique changed in it, preserved constraints, material visual changes, tested viewports and interactions, and remaining visual, behavioral, or structural gaps. For an independent release or quality verdict, use a fresh subagent or second independent context (verify-work) that sees the objective, diff, and evidence without being told the expected verdict. Use communicate-clearly for the final handoff.

## Pause points

DO-CONFIRM: work from judgment, then stop at each point and confirm every item. An unconfirmed item goes in the report, never silently past it.

**Before implementing**
- Visual intent recorded as inspectable constraints, not adjectives.
- Context chosen deliberately; defaults rejected or adopted by name.
- Direction plan written with concrete color, type, layout, inventory, and one signature; every block designed, including those whose content is a gap and those elided; type scale, breakpoints, spacing-to-role mapping, and radius stated rather than left to the implementer.
- Signature specified to its dimensions, tokens, behaviour, and bounds at each width, its internal parts summing to its stated size, and every alternate form drawn rather than named; complexity cut back to what the plan actually specifies.
- Every interaction given a location, affordance, label, timing, and keyboard semantics; type given size, leading, and tracking for every role at every width.
- Factual claims in page copy derived, not asserted; capability and security claims treated as fabrication.
- Contrast measured for every text role, every perceptible boundary including vertical edges, and every composited value — not only the source colours. Every colour on the page appears in the palette.
- Responsive consequence stated for every block whose composition changes, and a destination named for anything that disappears.
- Critique run and its outcome recorded as a self-administered claim; every substitute raised has a reported result, and each defeated substitute mutated once against the property that defeated it.
- Every free axis resolved to a decision with the kind of reason behind it; bare-convention values counted and cross-checked against the cluster tells, with any that sit on a tell derived or moved.
- The plan's own numbers checked: sample figures sum, clamps produce their stated values, every asserted count published as its list, every rendered element given a token, and every declared prohibition walked against the geometry drawn rather than against the record of what changed.
- Width-dependent constraints solved for the width where they fail, against the longest member of each declared vocabulary rather than the sample string.
- Wireframe positions plotted from the declared geometry, and every prohibition walked against that plotted drawing.
- Every derivation chain re-verified against the values that actually ship, and unit-checked.
- Concentration re-tested at every declared width, candidates ranked by drawn area.
- Sample-data markers on every block that renders invented values, in pixels and in the accessible name; no fabricated state attached to a real named entity.
- Any constraint a gate removed recorded as a loosening, with the concentration check re-run.

**Before claiming fidelity**
- Rendered result verified at the declared viewports.
- Signature element present in the render, not only in the plan.
- Every quality claim maps to a recorded check, not an impression.

**Before reporting a structure review**
- Scope named as an explicit file list; each module read whole, interface before body.
- Findings ordered by comprehension cost; clean files named as checked.
- No code changed anywhere in the review.
