#!/usr/bin/env bash
set -euo pipefail

repo_root=$(cd "$(dirname "$0")/.." && pwd)
cd "$repo_root"

bash -n \
  .claude/skills/brainstorming/scripts/start-server.sh \
  .claude/skills/brainstorming/scripts/stop-server.sh \
  .claude/skills/diagnose-systematically/find-polluter.sh \
  .claude/skills/subagent-driven-development/scripts/review-package \
  .claude/skills/subagent-driven-development/scripts/sdd-workspace \
  .claude/skills/subagent-driven-development/scripts/task-brief \
  tests/sdd-scripts.test.sh \
  tests/run.sh

node --test tests/*.test.cjs
bash tests/sdd-scripts.test.sh
