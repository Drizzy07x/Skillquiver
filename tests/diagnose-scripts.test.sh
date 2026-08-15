#!/usr/bin/env bash
set -euo pipefail

repo_root=$(cd "$(dirname "$0")/.." && pwd)
script="$repo_root/skills/diagnose-systematically/find-polluter.sh"
test_root=$(mktemp -d)
trap 'rm -rf "$test_root"' EXIT

mkdir -p "$test_root/tests"
printf 'fixture\n' > "$test_root/tests/example.test.js"

set +e
runner_output=$(cd "$test_root" && bash "$script" .pollution 'tests/*.test.js' false 2>&1)
runner_status=$?
set -e
if [ "$runner_status" -ne 3 ]; then
  printf 'failing runner returned %s instead of 3\n%s\n' "$runner_status" "$runner_output" >&2
  exit 1
fi
grep -q 'Test runner failed' <<< "$runner_output"
if grep -q 'all tests clean' <<< "$runner_output"; then
  echo 'failing runner was reported as clean' >&2
  exit 1
fi

set +e
empty_output=$(cd "$test_root" && bash "$script" .pollution 'missing/*.test.js' true 2>&1)
empty_status=$?
set -e
if [ "$empty_status" -ne 4 ]; then
  printf 'empty pattern returned %s instead of 4\n%s\n' "$empty_status" "$empty_output" >&2
  exit 1
fi
grep -q 'No test files matched' <<< "$empty_output"

cat > "$test_root/failing-polluter" <<'RUNNER'
#!/usr/bin/env bash
touch .pollution
exit 1
RUNNER
chmod +x "$test_root/failing-polluter"
set +e
polluter_output=$(cd "$test_root" && bash "$script" .pollution 'tests/*.test.js' "$test_root/failing-polluter" 2>&1)
polluter_status=$?
set -e
if [ "$polluter_status" -ne 1 ]; then
  printf 'failing polluter returned %s instead of 1\n%s\n' "$polluter_status" "$polluter_output" >&2
  exit 1
fi
grep -q 'FOUND POLLUTER' <<< "$polluter_output"

echo 'Diagnostic script tests passed'
