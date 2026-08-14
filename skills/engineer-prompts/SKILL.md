---
name: engineer-prompts
description: Builds or audits testable prompt contracts with explicit outcomes, permissions, tools, evidence, and stop conditions. Use when writing reusable agent prompts, system prompts, or prompts with unclear success criteria.
---

# Engineer Prompts

Turn an informal request into a prompt whose result can be verified. Keep the core contract provider- and version-neutral; add target-specific advice only when a target model is explicitly supplied and current documentation supports it.

## Workflow

1. Extract the requested outcome. Describe the finished state, not the activity.
2. Write observable success criteria. Avoid criteria such as "high quality" unless a measurable definition follows.
3. Separate boundaries from permissions:
   - boundaries state what is in and out of scope;
   - permissions state which reads, writes, network calls, installations, or external side effects are authorized.
4. Name the tools that may be used and the evidence required before claiming completion.
5. Define stop conditions for completion, blockers, exhausted retries, or required user decisions.
6. Include `target_model` only when the user requests model-specific optimization. Check version-matched current documentation first (see research-systematically) before adding model-specific guidance.
7. Check the contract structurally by hand: every required field present, every list non-empty with distinct strings, no unknown fields, fields kept in the canonical order below, no model names outside `target_model`. Then perform the semantic audit below — structural checks cannot determine whether prose is genuinely observable or authorized.
8. When a textual prompt is needed, render the contract into a stable prompt: one section per field, in the canonical order, wording taken verbatim from the contract, nothing added.

## Contract shape

Use a JSON object with these required fields, in this order:

```json
{
  "outcome": "A concrete finished state",
  "success_criteria": ["An observable condition"],
  "boundaries": ["A scope limit"],
  "permissions": ["An explicitly allowed action"],
  "tools": ["A tool or capability"],
  "evidence": ["Proof required for a claim"],
  "stop_conditions": ["A condition that ends or pauses work"]
}
```

Each list must contain at least one distinct, non-empty string. `target_model` is the only optional field. Do not add hidden requirements while normalizing the contract.

## Audit rules

- Reject ambiguous outcomes that only restate an action.
- Require criteria to describe externally checkable behavior or artifacts.
- Keep permissions explicit; tool availability does not imply authorization.
- Never claim tests, execution, review, or external publication without matching evidence.
- Preserve uncertainty and blockers instead of converting them into success.
- Do not assume a model family or version. If `target_model` is present, isolate model-specific recommendations so the underlying contract remains portable.
- Prefer concise instructions and remove duplicated constraints after preserving their meaning.

Structural checks prove field shape only. Semantic clarity, permission validity, evidence quality, and model improvement remain review judgments that must be reported honestly.

## Pause points

DO-CONFIRM: work from judgment, then stop at each point and confirm every item. An unconfirmed item goes in the report, never silently past it.

**Before rendering the contract**
- Every outcome is observable; none needs the author to judge success.
- Permissions, tools, and evidence obligations are named explicitly.

**Before delivering**
- Stop conditions exist and are reachable.
- The audit found no unstated permission or unobservable criterion.
