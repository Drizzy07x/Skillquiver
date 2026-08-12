---
name: writing-plans
description: Creates implementation plans with interfaces, tests, and open decisions. Use when a multi-step change needs planning.
---

# Writing Plans

Create a plan that another engineer can implement without inventing product
decisions. Announce: "I'm using the writing-plans skill to create the
implementation plan."

## Choose one route

Use **Bounded inline planning** when the user explicitly requests planning
only, requests read-only work, or says not to write code, and the prompt already
supplies the behavior, constraints, and required interfaces.

Use **Full repository planning** when the user requests a saved plan artifact,
asks for alignment with an existing codebase, names existing paths that affect
the design, or leaves architecture dependent on repository evidence.

Bounded inline planning takes precedence whenever its conditions match. A
named interface without a repository path is part of the supplied contract,
not a request for repository alignment. Do not switch routes merely because
the future implementation will integrate with existing code.

Creating a plan file is a workspace change. Return the plan inline unless the
user requests an artifact or the active workflow already authorizes one.

## Rules for every plan

- List externally observable decisions the requirements do not settle, such as
  exit status, output channel, overwrite policy, and partial-success semantics.
  Never silently choose them. Ask only when an answer changes plan structure.
- Do not add validation, normalization, or required-field rules for data the
  prompt only names. Preserve it as supplied and list any policy as unresolved.
- Never specify a behavior as required and then list that same behavior as
  unresolved. Describe the decision seam instead until the product choice exists.
- Label engineering recommendations as recommendations, not requirements.
- Define file responsibilities and interfaces. Mark unverified paths as
  proposed.
- Make each task an independently testable deliverable with focused tests.
- Include concrete behavior, edge cases, commands, and expected outcomes. Do
  not use `TBD`, `TODO`, "handle errors", or other placeholders.
- Split independent subsystems into separate plans when each can deliver useful
  software alone.

## Bounded inline planning

1. Treat facts supplied in the prompt as the planning contract. Do not inspect the
   workspace unless the user requests repository alignment.
2. Return at most four implementation tasks. Each task names proposed files,
   consumed and produced interfaces, behavior, edge cases, and focused tests.
3. Omit code samples, commit steps, plan files, todo tools, and execution-choice
   menus unless the user asks for them.
4. Cover parsing, validation, success and failure flow, integration boundaries,
   and tests where applicable.
5. End with unresolved externally observable decisions only, then deliver the
   plan immediately.

## Full repository planning

Read [references/full-plan.md](references/full-plan.md) completely before
inspecting the repository or drafting the plan. Follow that reference in
addition to the rules above. An explicit user output path overrides its default
artifact location.

## Self-review

Before responding, check specification coverage, placeholder absence, and
interface-name consistency. Fix gaps inline once; do not start a separate todo
or review workflow.

Completion requires a plan with complete behavior, interfaces, boundaries,
edge cases, and tests, plus an explicit list of unresolved product decisions.
