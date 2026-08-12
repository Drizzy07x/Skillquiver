# Direction plan

The artifact that stands between the brief and the code. Written into the intent file from section 1, critiqued, and only then built from. A plan that survives the critique is a set of decisions; a plan that skips it is a set of defaults wearing decision clothes.

## Template

Fill every field with concrete values. Adjectives are not values.

```
## Direction

color:                                              contrast vs its ground
  surface  #0F1712  deep forest — the subject's own material, not a neutral
  raised   #18231C  cards and wells                 1.2:1 vs surface (not text)
  ink      #E8EDE7  body text                       13.9:1 on surface  ✓
  muted    #7E8F84  captions, axis labels           4.8:1 on surface   ✓
  accent   #D8552A  single accent, at most 3×/screen 4.6:1 on surface  ✓ (18px+ only)

type:
  display  Fraunces 600, opsz 96 — the seed-catalog vernacular the subject comes from
           clamp(2.75rem, 6vw, 5rem) / 0.95 / -0.02em
  body     Public Sans 400 — 1.0625rem/1.65 desktop, 1rem/1.6 mobile, measure 64ch
  utility  IBM Plex Mono 500 — quantities and lot codes read as data, not prose
           0.8125rem/1.4, tabular lining, right-aligned in any column
  scale    5 / 3 / 1.75 / 1.0625 / 0.8125 rem

layout:
  family   two-column asymmetric, 62/38, single column below 768
  reason   every item pairs one specimen image with one dense data block; equal
           cards would flatten a relationship the content actually has
  values   breakpoints 375 / 768 / 1200; measure 64ch body, 42ch captions;
           spacing 4 8 16 24 40 64 104 px; radius 0 everywhere except 3px on the
           primary button — reason: printed stock has no rounded corners, so the
           one rounded thing is the one thing that is not printed

inventory:
  1 masthead      rank 3  wordmark, 4 links, primary action
  2 opening       rank 1  the germination line at full width + one sentence
  3 specimen ×6   rank 2  image + lot data block, alternating side
  4 sowing guide  rank 4  zone table, 12 rows, mono figures
  5 provenance    rank 5  where seed is grown — three ruled rows, region + year +
                          grower, GAP: content (brief names no source)
  6 order strip   rank 3  repeat of primary action, no new argument
  7 footer        rank 6  ruled columns, mono labels, legal

signature:
  what     the germination timeline runs as a continuous horizontal rule across
           the whole page, thickening at each stage
  why      the subject IS elapsed time; the page should be readable as a duration
```

Rules for the fields:

- **color** — 4–6 named values with hex and stated role. "A warm neutral palette" is not a plan. Name which single value carries the accent and how often it may appear. Measure every text-carrying value against the ground it sits on and write the ratio down: under 4.5:1, or 3:1 at 24px and 18.66px bold, the value changes here. A palette gets locked the moment the plan is approved; discovering the failure at render time means rebuilding, not adjusting.

  Three values get missed every time. **Boundaries** a reader must perceive — separators between surfaces, focus rings, input borders, the edge of a card — are held to 3:1 as non-text objects. **Composited values** are new colours: ink at 12% over the ground is neither ink nor the ground, so measure the result. **Remedies** are the most-missed of all: noticing that two surfaces sit at 1.14:1 and prescribing a hairline to carry the boundary is only half the work, because the hairline is itself a composite and will usually land near 1.26:1 — a fix 0.12 better than the problem. Measure the remedy or it is not one.
- **type** — one face per role, each with a one-line rationale tying it to the subject, and the scale. Display, body, and a utility face when the content has data, code, or captions. A rationale that would fit any subject is not a rationale — and a face named without a size, leading, and measure is half a decision: the implementer supplies the other half, from habit. Measuring colour to two decimals while stating no font size is a plan that audited the easy axis.
- **layout** — the layout family and the reason the content needs it, sketched as ASCII at desktop and mobile. Choosing a family because it is common is not a reason; choosing it because the content has the relationship that family expresses is.
- **inventory** — every block, in order, with a name, a rank, and the one thing it holds. Three failures this catches: a wireframe carrying boxes labelled `BLOCK 2`, an undecided decision drawn to look decided; a plan that resolves the hero in extraordinary detail and leaves the remaining eleven blocks to be improvised during implementation, where the defaults the critique just removed walk straight back in; and `GAP` used as an exemption. Missing content is not missing design — mark the block `GAP: content`, then design it anyway. The brief supplying no price says nothing about how many tiers, how they are ranked, or how the block is composed; those are still owed. A block is only droppable if the page genuinely should not have it, and that is a decision with a reason, not a gap.
- **signature** — one element, stated as *what* and *why*. Not two. The whole point is concentration.

  Assign type roles and spacing owners by **walking the drawing glyph by glyph**, not by listing the roles you remember writing. The ones that get missed are always the same: a stub label whose width feeds a breakpoint solve, the wordmark, an axis's day labels, a placeholder glyph, and every gap *inside* a block — heading to body, label to figure, prose to first row. Those interior gaps are usually the majority of a page's vertical whitespace, and a scale that owns only the gaps between blocks leaves them to be invented.

  It also gets the most complete spec on the page, because it is the element an implementer has no precedent for and will otherwise invent: overall dimensions, the palette token for every fill and stroke it uses, its internal geometry, its behaviour and timing, and how it is bounded at each width. A signature specified only as an idea arrives as whatever the implementer already knew how to draw — which is the default the whole critique just removed.

## ASCII wireframes

Sketch both widths before building. The wireframe is where a layout that reads well in prose gets caught being three stacked boxes.

```
desktop 1280                          mobile 375
┌────────────────────────┬─────────┐  ┌───────────────┐
│  SPECIMEN              │ lot 041 │  │   SPECIMEN    │
│  (full-bleed image)    │ 12 days │  │   (image)     │
│                        │ 8 seeds │  ├───────────────┤
├────────────────────────┤ zone 6b │  │ lot 041       │
│ ══════●════════●═══●══ │         │  │ 12 days       │
│   signature timeline   │         │  ├───────────────┤
├────────────────────────┴─────────┤  │ ═══●═══●══●══ │
│  next specimen ...               │  │  timeline     │
```

Every region in the wireframe carries the name it has in the inventory. A box with a placeholder label is a decision that has not been made yet, and a fill the wireframe draws in a value the palette does not name is a colour decided by accident.

State what breaks between the two widths — for **every** block whose composition changes, not only for the signature. Anything that disappears says where it went: navigation links that vanish at 375px have moved into a disclosure, into the footer, or out of the product, and which one it is, is a design decision. A block that survives unchanged is worth one line saying so, because silence reads the same whether a block was considered or forgotten. "Stacks" is not a mobile plan — say what happens to the signature element, to the density dial, and to any relationship the desktop layout was expressing spatially.

## Named default clusters

Observed attractors in AI-generated interface design as of 2026-08. They drift; treat the list as dated evidence, not as law, and add clusters you catch in your own output.

| Cluster | Tells | Legitimately right when |
| --- | --- | --- |
| Warm cream editorial | Background near `#F4F1EA`, high-contrast serif display, terracotta or rust accent, wide-tracked uppercase eyebrows | The subject is print, craft, food, or archival — and the palette comes from its own materials |
| Dark + single acid accent | Near-black surface, one vivid lime, vermilion, or cyan, faint glow, monospace labels | Developer tools, observability, anything read in a dark room where the accent maps to a real state |
| Broadsheet | Hairline rules, zero border-radius, dense multi-column grid, all-caps micro-labels | The content genuinely is editorial with a reading order that columns express |
| Indigo→violet SaaS | Gradient hero, glass cards, soft ambient shadow, uniform large radius | The brand actually owns that gradient |
| Centered hero + three equal cards + gradient CTA band | Layout default, appears under every palette | The three things really are peers with no hierarchy between them |
| Sequence markers `01 / 02 / 03` | Numbered eyebrows on content with no order | The content is an actual ordered process or a dated timeline |
| Bento grid | Mixed-size tiles on a landing page | Tile size encodes real differences in importance or data volume |
| Big number, small label, supporting stats | The default hero answer | The number is the product's actual thesis and is verifiable |

How to use it: **identify, then justify or replace.** Matching a cluster is allowed. Matching it without a stated reason is not. Where the brief pins the direction, the brief wins outright — including when it asks for one of these looks by name.

Three ways this table gets misread:

- **Whole looks instead of tells.** Each row lists several tells, and a plan can carry two of them while matching none of the row overall — pale ground plus rust accent places a page in warm-cream editorial for a viewer who never sees the serif you avoided. Score tells one at a time.
- **The table as an inventory.** It is dated evidence of where output clusters, not the complete set. Before running gate 2, write down the defaults of *this page kind* in this category — the layout everyone in the sector ships, the hero everyone opens with — and check against those too. A finance landing page's two-column label/amount ledger is a category default that appears in no row here.
- **Honest labelling as avoidance.** Withdrawing a reason you cannot defend is the right call and changes nothing on screen. If the undefended value sits on a tell, gate 3's bare-convention count is the trigger to move it, not the resolution.

## Critique protocol

Run before writing any code. Record the outcome in the intent file.

### Gate 1 — substitution test

For each reason: name the property of the subject it depends on, then hunt for a subject that has that property. The hunt is the test; the swap is only how you check.

Three rules make it work, and each exists because its absence has produced a false pass:

- **Adversarial selection.** The substitute set must contain the nearest subject you can construct that satisfies the reason — not the most convenient one. A finance page tested against a language-learning app has tested nothing: the substitute has no amounts, so half the reasons survive by default rather than by merit. Build the substitute that ought to defeat the reason, then see whether it does.
- **Report every substitute you raise.** A substitute named and left unresolved is a failed gate, not an omission. The characteristic failure is naming five substitutes, discussing the one the reason defeats, and reporting a pass — which converts the audit into evidence for a conclusion it never tested.
- **No pixel, no reason.** A distinguishing property that changes nothing in the rendered result is a story about the design, not a reason for it. "The intervals here are *involuntary*" sounds subject-specific and selects nothing: proportional gaps, a clamp, and hollow ticks render identically whether the interval was chosen or imposed. Ask what the plan would have to look like if the property were false. If the answer is "the same", the property is narrative.

Partial survival is failure. Revise the reason, or delete the decision it was defending — deleting is often the honest move, and a plan gets stronger by losing a decision it could not justify.

**Data shape transfers; institutional fact does not.** This is the single most useful thing to know about which reasons survive. A reason built on the *shape* of the content — a signed running total, irregular arrivals against steady drain, recurring items among one-offs, a quantity crossing a threshold — will always transfer, because shape is what a dozen unrelated products share. Medication adherence, cloud spend against budget, scheduled-job runs, and PTO balances all have the shape of personal finance, and a plan derived from shape re-derives for every one of them with the nouns swapped.

Reasons built on the subject's own institutional facts do not transfer, because no other subject has them: a direct debit that slips to the next working day, a statement cycle that is not the calendar month, a minor unit fixed at two places by law, an overdraft that makes the axis asymmetric around zero, a payday that lands on the last Friday. When a reason keeps surviving substitutes, the fix is usually not a narrower shape; it is to go find the fact.

**Compute the subject's quantity; do not hand-place it.** The most reliable way a decision becomes structural is that the drawing is *derived* from the domain's own model rather than positioned by hand. A bar placed at `left: 14.5833%` is exact and static, and it re-points to any neighbour subject by editing a number. A bar whose extent comes from a real periodic function crossing a threshold the reader sets — a tide height against a working depth, a load curve against a rated capacity — is malformed the moment you point it at a subject with no such continuous quantity: the lane renders empty and the threshold line means nothing. Same picture, completely different survival. Where the subject has a real model, implement it and let the geometry fall out; where it does not, say so rather than dressing static marks as an instrument.

**But the fact has to reach the form.** The test is not whether the substitute subject *lacks* the fact — it is whether the substitute would be **malformed** by the drawing, not merely mislabelled by it. If the same geometry serves with the strings swapped, the fact reached the copy and the fixture and stopped there, which is where it usually stops. Ask it concretely: hand the wireframe to the substitute and change only the words. If it still works, the specificity is decorative. What survives that test is a fact that constrains geometry — an axis that cannot be a month grid because the cycle is not a month, a decimal alignment that is not a preference because the minor unit is fixed by law, an origin that is not the left edge because the quantity goes negative.

**A fact present in the subject is not yet a fact structural to it.** This is where a careful plan still loses. "Harvesting is gated by tidal windows and by a licence the authority can revoke at hours' notice" sounds irreducibly specific and is not: it is *two incommensurate periodic series plus a revocable gate*, which is a shape, and a satellite-pass predictor with revocable spectrum clearance draws the identical instrument. Look instead for structure the domain has that its neighbours cannot have — a classification that is **graded** rather than binary, where two of its grades are conditionally workable after treatment; two suspension causes with different reinstatement dynamics; one site carrying different states per species at the same instant. Those force a row to be three-valued or multi-lane, and no neighbour subject can draw them. The test stays the same: hand the wireframe to the neighbour and change only the words. A binary gate survives that. A graded, multi-lane, per-species gate does not.

**And when the brief names a category rather than a subject, say so.** "A personal finance app" is a sector, not a product: no differentiator, no institutional posture, no audience. A plan cannot be more specific than its brief, and the honest ceiling is category-specific — reached by finding the facts the whole sector shares. Name that ceiling in the report rather than manufacturing a subject reason to fill it, and name the one question whose answer would raise it.

**Mutate the substitute that nearly won.** When a substitute is defeated by a property you name — "an inventory planner draws both sides discrete, because stock is a count of whole things" — the next test is that same substitute with the property removed: bulk inventory, fuel or grain or water, is metered continuously and fungible, and it draws your graphic exactly. Escapes are usually one mutation deep, and the defeat almost always lives in the subject you already circled rather than in a category you have not thought of. Stopping at the first substitute that fails is how a gate passes a reason that does not hold.

### Gates 2–4

2. **Cluster check** — walk the table above. Every match gets a written reason or a replacement. An anti-default reason ("the category does X, so I did the opposite") is not a subject reason: it explains why not X, never why this.
3. **Free-axis check** — every axis section 1 recorded as free resolves to a stated decision *and* to the kind of reason behind it: brief-pinned, subject-derived, downstream consequence, or bare convention. Bare convention is allowed and must be counted — an axis with no entry at all resolved to a default silently. Radius, ground colour, and iconography are where these hide, and ground is the largest area on the page. Cross-check every bare-convention value against the cluster tells from gate 2; derive or move any value that matches one.
4. **Concentration check** — test by removal. Remove the signature: the page should lose its identity. Remove each other candidate device: the page should lose detail only. Reclassifying a second device as "part of" the signature is a definitional move that resolves nothing — subordinate it visually or cut it.

Skip the critique only when the brief pins every axis.

### Gate 5 — consistency

The contrast rule works because it forces arithmetic. Nothing else in the plan gets that treatment by default, and every number the plan states is falsifiable by a reader with a calculator:

- **Sample data.** If the plan illustrates its thesis with figures, they have to add up. A signature whose whole argument is "one fixed length, fully consumed, every part named" is refuted on sight by a legend whose percentages sum to 64 and whose amounts leave a third of the band unaccounted. The illustration is the only place the thesis is ever tested — get it wrong and the plan has never once run its own idea.
- **Clamps and scales.** `clamp(2.25rem, 4.2vw, 3.5rem)` does not produce 56px at 1280 — it produces 53.76px, and reaches its maximum only at 1333px. State the value or state the width, then check that the formula yields it. Every size in the type table that also appears in a scale must appear in both, at both widths.
- **Counts.** "Thirty substitutes, each with a reported result" is checkable by counting the table. So is "one owner per spacing step" against three steps carrying three roles each.
- **Tokens.** Every element the wireframe renders — every fill, stroke, label, marker glyph, and button text — resolves to a named token.
- **Declared prohibitions against drawn geometry.** "These two values are never adjacent" is refuted by a packing rule that abuts them, a bracket that returns onto them, or a hover border drawn outside a filled block. Walk each prohibition against the geometry and either specify the offset that keeps it true or drop the claim.

### A critique may only tighten

Watch the direction a gate moves. Reversals that *add* a constraint — a legibility floor, a segment cap, an aggregation rule — are the gate working. A reversal that *removes* one is a loosening, and loosenings need the same scrutiny as decisions: record it as such, and re-run gate 4, because caps are usually the only thing holding concentration in place. A round of critique that ends with more specification and fewer limits has spent its rigor on precision and bought it with restraint.

### On independence

**These gates are self-administered, and that is their weakness.** The author who wrote a reason is the party least able to see that it transfers. Record every outcome as a claim — "gate 1: revised the layout reason, see below" — never as evidence that the plan is subject-specific.

Where the answer carries weight, hand the plan and the substitution instruction to a second independent context without telling it what the first pass concluded. Independent re-runs routinely reverse a gate the author passed, and the reversals are worth more than the passes: a gate that changes a decision has done work, a gate that rewrites a rationale sentence and leaves every value intact has not.

Independence relocates the bias; it does not remove it. The author still chooses which substitutes go in and which results come out, so adversarial selection and report-everything apply to the independent run too. And a decision revised in response to a critique carries exactly one round of scrutiny — the revision itself has not been tested. Say so rather than treating the post-revision plan as audited.

## Cross-session notes

Append to the intent file, under `## Tried`: directions considered and dropped, with one line on why. Successive passes on the same product converge on the same look otherwise — the notes are what makes the second pass different from the first rather than a re-run of it.

## Plan closure

Close the plan only when every decision an implementer would otherwise invent is explicit and the complete check set passes after the last repair.

- Specify every interaction's location, affordance, label, timing, and keyboard and assistive semantics.
- Give every type role size, leading, tracking, and measure at each declared width. Map each spacing step to its owners, and give every breakpoint a stated consequence.
- Bound the signature at every width. Its internal dimensions must sum correctly, and every alternate form must be drawn rather than named. Reduce its complexity until the complete specification fits.
- Treat the specimen as a real product state: its geometry and copy must agree. Derive factual, capability, and security claims or remove them.
- Solve width-dependent constraints for the width at which they fail. Test against the longest member of each declared vocabulary, not only the sample string or endpoint widths.
- Plot wireframe positions from declared geometry. Walk every prohibition against that plotted drawing.
- Recompute every derivation chain against the final values and check its units.
- At every declared width, rank the signature and competing devices by drawn area. Removing the signature must remove identity; removing another device must remove detail only.
- Verify all sample figures, formulas, clamps, counts, tokens, contrast ratios, boundaries, and composited values. A count is checkable only when its members are enumerated.
- Mark every block containing illustrative values in pixels and in its accessible name. Use fictional identifiers for invented state; never attach it to a real named entity.

Repairs can invalidate untouched decisions. After every repair, re-run the entire check set and keep the earlier version when the repair makes the system worse. The specification budget applies to the whole plan: when new scope causes old checks to fail, cut scope before adding another element.

The checks trade against one another. Record which axis the brief prioritizes and re-run the checks that a new capability makes harder, not only those it improves. A self-administered pass remains a claim; use an independent context for consequential fidelity judgments.
