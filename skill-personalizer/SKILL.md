---
name: skill-personalizer
description: Audits and adapts community or newly installed Agent Skills to the user's tools, directories, habits, and session history. Use when a downloaded, forked, or generated skill has triggers that feel wrong, noisy, or too generic, or references tools the user does not have.
---

# Skill Personalizer

## Overview

Audit and tune a skill for one user's real environment. The goal is not public portability; it is better triggering, less friction, and stronger fit with the user's actual tools, paths, style, and recurring tasks.

## When To Use

- A user installs a skill from GitHub or creates one from scratch and wants it to fit their setup.
- A skill undertriggers, overtriggers, asks unnecessary questions, or misses the user's preferred workflow.
- A user asks whether an existing skill is good, broken, noisy, too long, conflicting, or worth keeping.
- Local paths, aliases, memories, CLIs, MCP tools, or repo conventions should be reflected in the skill.

Do not use when preparing a skill for public release; use `skill-generalizer` for that.

## Workflow

1. Inspect the target skill, installed copies, local memories, and real session evidence when available.
2. Run the audit checks in [audit-rubric.md](references/audit-rubric.md) when quality, trigger fit, or retention is unclear.
3. Identify the user's recurring phrasing, expected autonomy level, tools, directories, and verification habits.
4. Compare the skill's trigger conditions against real user requests that should or should not load it.
5. Edit only the target skill and bundled resources needed for personalization.
6. Add concrete local defaults, preferred commands, safety boundaries, and verification steps.
7. Preserve useful upstream behavior; document any intentional local divergence.
8. Validate with realistic prompts and a frontmatter/layout check.

## Personalization Rules

- Personal details are allowed only if they improve this user's future execution.
- Do not add brittle fallbacks that hide broken local setup.
- Prefer real local evidence over generic best practices.
- Keep trigger descriptions broad enough to catch the user's natural phrasing.
- If editing an installed third-party skill, avoid changing upstream attribution or license text.

## References

Read [audit-rubric.md](references/audit-rubric.md) for the diagnostic checklist for existing skills.

Read [personalization-rubric.md](references/personalization-rubric.md) for local defaults, session evidence, and validation scenarios.
