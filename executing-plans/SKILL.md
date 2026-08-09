---
name: executing-plans
description: Executes a written implementation plan inline, task by task, stopping only on blockers. Use when a plan exists and subagent dispatch is unavailable, or the user wants the plan executed in a separate session.
---

# Executing Plans

## Overview

Load plan, review critically, execute all tasks, report when complete.

**Announce at start:** "I'm using the executing-plans skill to implement this plan."

**Routing:** Use this skill when subagent dispatch is unavailable OR the user wants a separate execution session; otherwise use subagent-driven-development.

## The Process

### Step 1: Load and Review Plan
1. Ensure an isolated workspace: use using-git-worktrees to create one or verify the existing one
2. Read plan file
3. Review critically - identify any questions or concerns about the plan
4. If concerns: Raise them with the user before starting
5. If no concerns: Create todos for the plan items and proceed

### Step 2: Execute Tasks

For each task:
1. Mark as in_progress
2. Follow each step exactly (plan has bite-sized steps)
3. Run verifications as specified
4. Mark as completed

Track completed tasks in a ledger file (reuse subagent-driven-development's convention: `<workspace>/progress.md`, first line naming the plan file, one `Task <N>: complete` line per finished task) so a compacted session can resume where it stopped.

### Step 3: Complete Development

After all tasks complete and verified:
- Before claiming the work is done, apply verification-before-completion: run the verification commands and confirm their output first
- Announce: "I'm using the finishing-a-development-branch skill to complete this work."
- **REQUIRED SUB-SKILL:** Use finishing-a-development-branch
- Follow that skill to verify tests, present options, execute choice

## When to Stop and Ask for Help

**STOP executing immediately when:**
- Hit a blocker (missing dependency, test fails, instruction unclear)
- Plan has critical gaps preventing starting
- You don't understand an instruction
- Verification fails repeatedly

**Ask for clarification rather than guessing.**

## When to Revisit Earlier Steps

**Return to Review (Step 1) when:**
- Partner updates the plan based on your feedback
- Fundamental approach needs rethinking

**Don't force through blockers** - stop and ask.

## Remember
- Review plan critically first
- Follow plan steps exactly
- Don't skip verifications
- Reference skills when plan says to
- Stop when blocked, don't guess
- Never start implementation on main/master branch without explicit user consent
