# Full Repository Plan Reference

Use this reference only for the Full repository planning route in `SKILL.md`.

## Audience and scope

Assume a skilled implementer with no codebase context. Inspect only files needed
to identify conventions, entry points, interfaces, and test commands. Preserve
existing structure unless the feature requires a change.

Specify exact files, code or pseudocode, tests, docs, commands, and outcomes.
Apply DRY, YAGNI, TDD, and frequent small commits.

Map the files to create or modify and give each one a single responsibility.
Files that change together should live together. Split by responsibility, not
by technical layer. If the existing codebase uses large files, do not introduce
an unrelated restructuring.

## Task sizing

A task is the smallest independently testable deliverable worth a review gate.
Fold setup, scaffolding, and docs into the task that needs them. Split only
where a reviewer could approve one task and reject its neighbor.

Within each task, use small ordered actions:

1. Add or update the focused failing test.
2. Run it and record the expected relevant failure.
3. Implement the minimum behavior.
4. Run the focused test and record the expected pass.
5. Run any affected integration check.
6. Commit the independently passing deliverable.

## Plan document header

Every plan MUST start with this header:

```markdown
# [Feature Name] Implementation Plan

> **For agentic workers:** Use the host's available task-by-task implementation workflow. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** [One sentence describing what this builds]

**Architecture:** [Two or three sentences describing the approach]

**Tech Stack:** [Relevant languages, frameworks, and tools]

## Global Constraints

[Exact project-wide requirements copied from the specification]

---
```

## Task template

Use this shape for each task:

````markdown
### Task N: [Deliverable]

**Files:**
- Create: `exact/proposed/or/observed/path`
- Modify: `exact/observed/path:line`
- Test: `tests/exact/path`

**Interfaces:**
- Consumes: [exact existing or prior-task signatures]
- Produces: [exact signatures later tasks rely on]

- [ ] **Step 1: Add the focused failing test**

[Exact test cases and assertions]

- [ ] **Step 2: Verify the relevant failure**

Run: `[focused command]`
Expected: `[specific failure proving missing behavior]`

- [ ] **Step 3: Implement the minimum behavior**

[Exact logic, boundaries, and edge cases]

- [ ] **Step 4: Verify the focused pass**

Run: `[focused command]`
Expected: `[specific passing result]`

- [ ] **Step 5: Run the affected integration check**

Run: `[integration command]`
Expected: `[specific passing result]`

- [ ] **Step 6: Commit the passing deliverable**

```bash
git add [exact files from this task]
git commit -m "feat: add specific behavior"
```
````

Repeat signatures when tasks may be implemented independently. Name exact
interfaces instead of referring only to "the previous task".

## No Placeholders

Never write:

- `TBD`, `TODO`, "implement later", or "fill in details".
- "Add appropriate error handling" or "handle edge cases" without enumerating
  the exact cases and outcomes.
- "Write tests for the above" without exact cases and assertions.
- "Similar to Task N" instead of repeating required context.
- Steps that omit the actual code or pseudocode needed to implement them.
- A function, type, file, or command that no task defines or verifies.

## Self-review details

Check the completed plan once:

1. **Specification coverage:** Every requirement maps to a task or global
   constraint.
2. **Placeholder scan:** Every step contains the information needed to act.
3. **Interface consistency:** Names and signatures match across tasks.
4. **Repository grounding:** Observed paths are distinguished from proposed
   paths, and commands match the repository's actual tooling.

Correct discovered gaps inline without starting another workflow.

## Execution Handoff

Save an authorized artifact to `docs/plans/YYYY-MM-DD-<feature-name>.md` unless
the user supplied another path. Report that path and offer two execution modes
when the host exposes them:

1. **Subagent-Driven** — use `subagent-driven-development` for a fresh worker
   per task with review between tasks.
2. **Inline Execution** — use `executing-plans` for inline task-by-task
   execution, stopping on blockers.

Name the actual available host workflow behind each option. Do not claim a
subagent, worktree, or plan-execution tool is available unless the current host
exposes it.
