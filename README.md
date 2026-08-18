<div align="center">

<img src="assets/banner.svg" alt="Skillquiver — 24 skills shared by ChatGPT, Claude Code, and Codex" width="800">

[![License: MIT](https://img.shields.io/badge/license-MIT-8B929E)](LICENSE)
![Skills](https://img.shields.io/badge/skills-24-C87941)
![Shared](https://img.shields.io/badge/shared-24-7FA6A0)
![ChatGPT](https://img.shields.io/badge/ChatGPT-24-10A37F)
![Claude Code](https://img.shields.io/badge/Claude%20Code-24-E0A458)
![Codex](https://img.shields.io/badge/Codex-24-E8E4DC)

**24 skills shared by ChatGPT, Claude Code, and Codex.**

Each skill tells the agent what it does and when to use it, so the right workflow can activate without you memorizing its name.

**[See what each skill does and when it steps in →](https://drizzy07x.github.io/Skillquiver/)**

</div>

## Installation

The repository contains the 24-skill `2.2.0` candidate. The official Plugins Directory remains the recommended distribution for ChatGPT and Codex, but its published version can lag this source tree. Claude Code can install the current source catalog from the repository marketplace.

### ChatGPT

Open the Plugins Directory in ChatGPT, search for **Skillquiver**, note the displayed version, and select Add. ChatGPT uses `@` mentions when you want to select a bundled skill explicitly. The new 24-skill catalog is available there only after the listing shows version `2.2.0`.

### Claude Code

Inside an interactive Claude Code session:

```text
/plugin marketplace add Drizzy07x/Skillquiver
/plugin install skillquiver@skillquiver
```

Or from a terminal:

```bash
claude plugin marketplace add Drizzy07x/Skillquiver
claude plugin install skillquiver@skillquiver --scope user
```

Claude Code installs all 24 skills. Update later with:

```text
/plugin update skillquiver@skillquiver
```

or:

```bash
claude plugin update skillquiver@skillquiver
```

For a manual global install, clone the repository and copy the shared catalog:

```bash
git clone https://github.com/Drizzy07x/Skillquiver.git
mkdir -p ~/.claude/skills
cp -r Skillquiver/skills/* ~/.claude/skills/
```

Use a project's `.claude/skills/` directory instead for a project-only install.

### Codex

From a terminal:

```bash
codex plugin marketplace add Drizzy07x/Skillquiver
codex plugin add skillquiver@skillquiver
```

Codex installs all 24 skills. Refresh the marketplace and reinstall the plugin to update:

```bash
codex plugin marketplace upgrade skillquiver
codex plugin add skillquiver@skillquiver
```

For a manual global install:

```bash
git clone https://github.com/Drizzy07x/Skillquiver.git
mkdir -p ~/.codex/skills
cp -r Skillquiver/skills/* ~/.codex/skills/
```

Use a project's `.agents/skills/` directory instead for a project-only install. Plugins are supported in Codex CLI and the Codex desktop app; use the manual project install for clients that do not load plugins.

> [!IMPORTANT]
> **v2.2 candidate:** `improve-agent-instructions` adds scoped `AGENTS.md` and `CLAUDE.md` maintenance. Skillquiver Doctor moved into `skills/` in v2.1. Existing marketplace installs update through their host commands above. Manual installations copy only `skills/` for the complete 24-skill catalog.

## Repository layout

```text
Skillquiver/
├── skills/                              # 24 skills shared by all three hosts
├── .claude-plugin/plugin.json           # exposes all 24 to Claude Code
└── .codex-plugin/plugin.json            # exposes all 24 to Codex
```

## Skills

Shared compatibility badge: ![ChatGPT + Claude Code + Codex](https://img.shields.io/badge/ChatGPT%20%2B%20Claude%20Code%20%2B%20Codex-supported-7FA6A0)

### Planning

| Skill | Compatibility | What it does |
|-------|---------------|--------------|
| [brainstorming](skills/brainstorming/SKILL.md) | ![ChatGPT + Claude Code + Codex](https://img.shields.io/badge/ChatGPT%20%2B%20Claude%20Code%20%2B%20Codex-supported-7FA6A0) | Explores user intent, requirements, and design before implementation. |
| [writing-plans](skills/writing-plans/SKILL.md) | ![ChatGPT + Claude Code + Codex](https://img.shields.io/badge/ChatGPT%20%2B%20Claude%20Code%20%2B%20Codex-supported-7FA6A0) | Writes a task-by-task implementation plan document from a spec, before touching code. |
| [executing-plans](skills/executing-plans/SKILL.md) | ![ChatGPT + Claude Code + Codex](https://img.shields.io/badge/ChatGPT%20%2B%20Claude%20Code%20%2B%20Codex-supported-7FA6A0) | Executes a written implementation plan inline, task by task, stopping only on blockers. |
| [subagent-driven-development](skills/subagent-driven-development/SKILL.md) | ![ChatGPT + Claude Code + Codex](https://img.shields.io/badge/ChatGPT%20%2B%20Claude%20Code%20%2B%20Codex-supported-7FA6A0) | Executes a plan by dispatching one subagent per task with per-task review gates, keeping orchestrator context small. |
| [dispatching-parallel-agents](skills/dispatching-parallel-agents/SKILL.md) | ![ChatGPT + Claude Code + Codex](https://img.shields.io/badge/ChatGPT%20%2B%20Claude%20Code%20%2B%20Codex-supported-7FA6A0) | Dispatches parallel subagents, one per independent domain, to handle unrelated problems concurrently. |

### Execution

| Skill | Compatibility | What it does |
|-------|---------------|--------------|
| [test-driven-development](skills/test-driven-development/SKILL.md) | ![ChatGPT + Claude Code + Codex](https://img.shields.io/badge/ChatGPT%20%2B%20Claude%20Code%20%2B%20Codex-supported-7FA6A0) | Enforces test-first red-green-refactor: failing test, minimal code to pass, verify green. |
| [solve-efficiently](skills/solve-efficiently/SKILL.md) | ![ChatGPT + Claude Code + Codex](https://img.shields.io/badge/ChatGPT%20%2B%20Claude%20Code%20%2B%20Codex-supported-7FA6A0) | Routes work efficiently with progressive context discovery, matched effort, and durable project mapping. |
| [handle-host-boundaries](skills/handle-host-boundaries/SKILL.md) | ![ChatGPT + Claude Code + Codex](https://img.shields.io/badge/ChatGPT%20%2B%20Claude%20Code%20%2B%20Codex-supported-7FA6A0) | Handles unavailable host-specific skills and tools without fabricating capabilities or crossing host boundaries. |
| [execute-durably](skills/execute-durably/SKILL.md) | ![ChatGPT + Claude Code + Codex](https://img.shields.io/badge/ChatGPT%20%2B%20Claude%20Code%20%2B%20Codex-supported-7FA6A0) | Runs long or interruption-prone work against an external state file with falsifiable criteria and an append-only evidence log. |
| [refactor-safely](skills/refactor-safely/SKILL.md) | ![ChatGPT + Claude Code + Codex](https://img.shields.io/badge/ChatGPT%20%2B%20Claude%20Code%20%2B%20Codex-supported-7FA6A0) | Refactors working code and lands changes in untested legacy code without altering observable behavior. |
| [using-git-worktrees](skills/using-git-worktrees/SKILL.md) | ![ChatGPT + Claude Code + Codex](https://img.shields.io/badge/ChatGPT%20%2B%20Claude%20Code%20%2B%20Codex-supported-7FA6A0) | Ensures an isolated workspace exists via native tools or git worktree fallback before feature work. |
| [communicate-clearly](skills/communicate-clearly/SKILL.md) | ![ChatGPT + Claude Code + Codex](https://img.shields.io/badge/ChatGPT%20%2B%20Claude%20Code%20%2B%20Codex-supported-7FA6A0) | Controls report verbosity with the shortest profile that preserves evidence; explains external sources in plain language. |

### Verification & debugging

| Skill | Compatibility | What it does |
|-------|---------------|--------------|
| [diagnose-systematically](skills/diagnose-systematically/SKILL.md) | ![ChatGPT + Claude Code + Codex](https://img.shields.io/badge/ChatGPT%20%2B%20Claude%20Code%20%2B%20Codex-supported-7FA6A0) | Finds the cause of a defect through observable evidence: reproduces, minimizes, tests falsifiable hypotheses one variable at a time. |
| [verification-before-completion](skills/verification-before-completion/SKILL.md) | ![ChatGPT + Claude Code + Codex](https://img.shields.io/badge/ChatGPT%20%2B%20Claude%20Code%20%2B%20Codex-supported-7FA6A0) | Requires running verification commands and confirming output before any success claim; evidence before assertions. |
| [verify-work](skills/verify-work/SKILL.md) | ![ChatGPT + Claude Code + Codex](https://img.shields.io/badge/ChatGPT%20%2B%20Claude%20Code%20%2B%20Codex-supported-7FA6A0) | Independently audits finished work: verifies a delivery or completion claim against real evidence. |
| [research-systematically](skills/research-systematically/SKILL.md) | ![ChatGPT + Claude Code + Codex](https://img.shields.io/badge/ChatGPT%20%2B%20Claude%20Code%20%2B%20Codex-supported-7FA6A0) | Freezes the question before collecting results, binds every claim to a source, pins docs to the installed dependency version. |

### Code review

| Skill | Compatibility | What it does |
|-------|---------------|--------------|
| [requesting-code-review](skills/requesting-code-review/SKILL.md) | ![ChatGPT + Claude Code + Codex](https://img.shields.io/badge/ChatGPT%20%2B%20Claude%20Code%20%2B%20Codex-supported-7FA6A0) | Dispatches a code-reviewer subagent to check finished work against requirements before it merges. |
| [receiving-code-review](skills/receiving-code-review/SKILL.md) | ![ChatGPT + Claude Code + Codex](https://img.shields.io/badge/ChatGPT%20%2B%20Claude%20Code%20%2B%20Codex-supported-7FA6A0) | Processes review feedback with rigor: verify each claim against the code before implementing, push back with evidence. |
| [finishing-a-development-branch](skills/finishing-a-development-branch/SKILL.md) | ![ChatGPT + Claude Code + Codex](https://img.shields.io/badge/ChatGPT%20%2B%20Claude%20Code%20%2B%20Codex-supported-7FA6A0) | Guides integration of a finished branch: verify tests, present merge/PR/keep/discard options, clean up worktrees. |

### UI & automation

| Skill | Compatibility | What it does |
|-------|---------------|--------------|
| [design-ui](skills/design-ui/SKILL.md) | ![ChatGPT + Claude Code + Codex](https://img.shields.io/badge/ChatGPT%20%2B%20Claude%20Code%20%2B%20Codex-supported-7FA6A0) | Turns visual intent into inspectable constraints, commits to a stated visual direction, builds it as one system, and verifies the rendered result. |
| [automate-ui](skills/automate-ui/SKILL.md) | ![ChatGPT + Claude Code + Codex](https://img.shields.io/badge/ChatGPT%20%2B%20Claude%20Code%20%2B%20Codex-supported-7FA6A0) | Drives web and desktop UIs adaptively while capturing evidence that separates navigation from behavioral proof. |

### System

| Skill | Compatibility | What it does |
|-------|---------------|--------------|
| [improve-agent-instructions](skills/improve-agent-instructions/SKILL.md) | ![ChatGPT + Claude Code + Codex](https://img.shields.io/badge/ChatGPT%20%2B%20Claude%20Code%20%2B%20Codex-supported-7FA6A0) | Audits and improves global, project, and nested `AGENTS.md` and `CLAUDE.md` guidance while preserving host-specific behavior. |
| [skillquiver-doctor](skills/skillquiver-doctor/SKILL.md) | ![ChatGPT + Claude Code + Codex](https://img.shields.io/badge/ChatGPT%20%2B%20Claude%20Code%20%2B%20Codex-supported-7FA6A0) | Audits host-local skills, plugins, and hooks for demonstrated conflicts, then offers reversible repairs with per-item consent. |

### Prompt engineering

| Skill | Compatibility | What it does |
|-------|---------------|--------------|
| [engineer-prompts](skills/engineer-prompts/SKILL.md) | ![ChatGPT + Claude Code + Codex](https://img.shields.io/badge/ChatGPT%20%2B%20Claude%20Code%20%2B%20Codex-supported-7FA6A0) | Builds or audits a prompt contract with explicit outcomes, boundaries, permissions, required evidence, and stop conditions. |

## Support and legal

- Publisher: **Drizzy07x**
- [Support](https://github.com/Drizzy07x/Skillquiver/issues)
- [Privacy policy](https://drizzy07x.github.io/Skillquiver/privacy.html)
- [Terms of use](https://drizzy07x.github.io/Skillquiver/terms.html)
- [MIT license](LICENSE)
