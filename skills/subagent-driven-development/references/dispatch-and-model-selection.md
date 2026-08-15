# Dispatch and Model Selection

Read this reference before the first worker dispatch and whenever a task changes role or capability needs.

## Host Dispatch Mapping

Treat the worker templates' `task_label`, `message`, and optional `model_override` as host-neutral fields.

### Codex

For every fresh worker, call `spawn_agent` with:

```text
task_name: task_n_implement        # stable snake_case label derived from task_label
message: <entire template message>
fork_turns: "none"                # pass only the context constructed in message
model: <model_override>            # include only when overrides are supported and selected
```

Record the returned worker target. For fix rounds 1–3, call `followup_task` with that same `target` and the findings in `message`; keep the original worker while it remains available.

### ChatGPT and other hosts

Map `task_label` and `message` to the closest general-purpose worker dispatch fields. Include `model_override` only when the host exposes per-worker model selection.

## Model Selection

Use the least powerful model that can complete the role reliably. Omit the model field when the host does not support overrides.

- Mechanical implementation with a complete specification or a one-to-two-file change: cheap model.
- Multi-file integration, pattern matching, or debugging: standard model.
- Architecture, design, and final whole-branch review: most capable model.
- Task review: match the model's judgment to the diff's size, complexity, and risk; use a mid-tier model as the floor for prose-defined work.
- Scoped re-review of a small fix: cheap-to-mid tier.
- Fix rounds 4–5: at least one tier above the implementer that stalled.

Turn count beats token price. Cheap models that need repeated turns can cost more overall. When the dispatch API supports an override, specify it explicitly so an expensive session default is not inherited accidentally.

Completion criterion: every fresh dispatch uses the correct host fields, isolated context, and an explicitly chosen model whenever the host supports overrides.
