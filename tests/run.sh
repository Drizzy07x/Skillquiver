#!/usr/bin/env bash
set -euo pipefail

repo_root=$(cd "$(dirname "$0")/.." && pwd)
cd "$repo_root"

bash -n \
  skills/brainstorming/scripts/start-server.sh \
  skills/brainstorming/scripts/stop-server.sh \
  skills/diagnose-systematically/find-polluter.sh \
  skills/subagent-driven-development/scripts/review-package \
  skills/subagent-driven-development/scripts/sdd-workspace \
  skills/subagent-driven-development/scripts/task-brief \
  tests/sdd-scripts.test.sh \
  tests/run.sh

node --test tests/*.test.cjs
bash tests/benchmark-wrapper.test.sh
bash tests/sdd-scripts.test.sh
