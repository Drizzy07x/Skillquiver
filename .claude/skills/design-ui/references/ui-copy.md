# Writing interface copy

Words in an interface exist to make it easier to understand and therefore easier to use. They are design material, held to the same standard as spacing and color. Generic copy makes a design read as templated no matter how the layout was resolved.

Before writing any string, name what the design needs to say at that point and what the reader is trying to do there.

## Rules

- **Name things by what the person controls**, never by how the system is built. A person manages notifications, not webhook configuration. Describe what something does in plain terms instead of selling it.
- **Specific beats clever.** "Export the last 90 days as CSV" over "Take your data with you."
- **Active voice, and the control says what happens.** "Save changes", not "Submit". "Delete workspace", not "Confirm".
- **One name per action, through the whole flow.** The button that says Publish produces a toast that says Published and a state that reads Published. Renaming an action mid-flow is how people get lost.
- **Errors say what happened and what to do next**, in the interface's voice. They do not apologize and they are never vague. "That file is 48 MB — the limit is 25 MB" beats "Something went wrong."
- **Empty states are an invitation to act**, not a mood. Say what would be here and give the one control that puts something here.
- **Sentence case, plain verbs, no filler.** Tone matched to brand and audience, register conversational.
- **One job per element.** A label labels. An example demonstrates. Nothing quietly does double duty — a helper text that is secretly the error message is two jobs in one string.
- **Loading and disabled states say why.** A disabled control that does not explain its condition is a dead end.

## The fabrication boundary

Writing copy is in scope in every mode. Inventing evidence is out of scope in every mode. The line is whether a reader could reasonably take the string as a verifiable claim about the world.

| Write it | Never fabricate it |
| --- | --- |
| Labels, buttons, nav, headings, section intros | Metrics, percentages, uptime, user counts, revenue |
| Empty, loading, error, disabled, success text | Testimonials, quotes, names, job titles, avatars |
| Form field names, helper text, validation messages | Customer names, client logos, case studies |
| Feature descriptions of behavior that exists | Awards, certifications, compliance badges, ratings |
| Placeholder body copy, marked as placeholder | Operational state — order counts, live activity, stock |
| Naming what a feature is for | Capability, security, and privacy claims — "read-only", "we never sell your data", "encrypted at rest", "cannot move money" |

For anything in the right column: use what the brief supplied, or render the slot with a visible marker naming what is missing. A marked gap is a finding for the report; a plausible invented number is a defect that ships.

The right column is easy to police in a badge and easy to miss in a sentence. "The connection is read-only and cannot move money" is the same class of claim as a compliance badge — an assertion about a system nobody has built, in the exact block that refused the badge for being unsupplied. Prose is where fabrication survives a review that only looked at the graphics.

**The marker has to reach everyone.** A sample-data label drawn as a visual box does not exist for a screen reader: if a figure, chart, or table carries fabricated or illustrative values, the qualifier belongs in the accessible name too, not only in the pixels. A disclaimer the assistive layer cannot see is a disclaimer for sighted readers only.

**And it has to reach every block.** Marking the hero figure and leaving the specimen table, the activity log, and the card list unmarked is the usual shape of this failure — the qualifier attaches to the element that was easiest to caption, not to every element that renders invented values. Walk the wireframe block by block: anything drawing a figure, a state, a date, or a record gets the marker in pixels and in its accessible name, or it reads as real.

**An answer the reader authored is not the product's answer.** The subtlest fabrication has no invented data in it at all: the interface takes a parameter the reader sets — a threshold, a tolerance, a working depth — feeds it into a consequential verdict, and prints the result in the product's voice. The same instant reads "no window" at one slider position and "work now" at another, so whoever last touched the control wrote the legal answer and the page signed it. Check every output that carries authority against every input the reader controls: if moving a control changes the verdict, the verdict belongs to the reader, and the copy has to say which part the product determined and which part the reader supplied. Where the real constraint is external — set by law, by an authority, by a published schedule — a reader-set approximation of it may inform, but must never be rendered as the thing itself.

**Never attach fabricated state to a real named entity.** Illustrative data on an invented place, account, or product is a sample; the same data on a real, identifiable one is a false record about something a reader can look up — and for a regulated subject it is a false record with legal consequence. Two contradictory states for the same named entity in one viewport is the same defect twice. Use clearly fictional identifiers for sample data, or use real ones only for facts you derived and can cite.

## Copy-quality check

Run against the actual render, not against the source. Mark pass / fail / not-evaluated with a concrete note.

- Every action keeps one name across its flow.
- No string names a system concept the person does not control.
- Error and empty states name a cause and a next step.
- Nothing in the right-hand column above appears without a supplied source.
- Read the primary path's strings in order: they should form a coherent voice, not three voices from three sections.
