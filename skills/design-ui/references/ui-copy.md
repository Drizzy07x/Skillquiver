# Writing Interface Copy

Treat words as functional design material. Before writing a string, name what
the interface must communicate and what the reader is trying to do.

## Rules

- Name what the person controls, not internal architecture.
- Prefer specific plain language over clever or promotional phrasing.
- Use active verbs; controls state the outcome: “Save changes”, not “Submit”.
- Keep one name for an action across button, progress, success, and state text.
- Give each element one job: label, example, helper, error, or status.
- Errors state what happened and the next action. Empty states state what would
  appear and provide the action that creates it.
- Explain why a control is disabled or still loading.
- Use sentence case and a voice appropriate to the audience.

## Fabrication boundary

Create labels, navigation, headings, instructions, form help, validation,
empty/loading/error/disabled/success text, and descriptions of behavior that
actually exists. Use supplied facts for metrics, testimonials, customers,
awards, compliance, security, privacy, operational state, and capability
claims. If a source is missing, show a visible `GAP` or clearly marked sample;
do not invent plausible evidence.

Apply the marker to every block containing illustrative figures, dates, names,
records, charts, or states, both visibly and in its accessible name. Use
fictional identifiers; never attach invented state to a real person, company,
account, place, or product.

If user-controlled input changes a consequential verdict, distinguish the
reader's assumption from what the product actually determined. A threshold the
reader selected must not be presented as a legal, medical, financial, safety,
or operational fact supplied by the product.

## Render check

Against the actual render, record pass, fail, or not evaluated:

- Every action keeps one name through its flow.
- Controls use direct verbs and labels match the person's mental model.
- Error, empty, disabled, and loading states explain cause or next action.
- Primary-path strings read as one coherent voice.
- Every factual claim has a supplied or cited source.
- Every illustrative block is marked visually and accessibly.
