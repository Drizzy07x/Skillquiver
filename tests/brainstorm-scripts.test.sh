#!/usr/bin/env bash
set -euo pipefail

repo_root=$(cd "$(dirname "$0")/.." && pwd)
script="$repo_root/skills/brainstorming/scripts/start-server.sh"

for option in --project-dir --host --url-host --idle-timeout-minutes; do
  set +e
  output=$(timeout 2 bash "$script" "$option" 2>&1)
  status=$?
  set -e
  if [ "$status" -ne 2 ]; then
    printf '%s without a value returned %s instead of 2\n%s\n' "$option" "$status" "$output" >&2
    exit 1
  fi
  grep -q -- "$option requires a value" <<< "$output"
done

echo 'Brainstorm script tests passed'
