#!/usr/bin/env bash
# Linear scan to find which test creates unwanted files/state
# Requires a Bash-capable shell. On Windows, run it through Git Bash;
# it will not work under PowerShell or cmd.
# Usage: ./find-polluter.sh <file_or_dir_to_check> <test_pattern> [test_runner]
#   test_runner: command used to run a single test file (default: npm test)
# Examples:
#   ./find-polluter.sh '.git' 'src/**/*.test.ts'
#   ./find-polluter.sh '.git' 'src/**/*.test.ts' 'npx vitest run'

set -e

if [ $# -lt 2 ] || [ $# -gt 3 ]; then
  echo "Usage: $0 <file_to_check> <test_pattern> [test_runner]"
  echo "Example: $0 '.git' 'src/**/*.test.ts' 'npx vitest run'"
  exit 1
fi

POLLUTION_CHECK="$1"
TEST_PATTERN="$2"
TEST_RUNNER="${3:-npm test}"

# Each iteration detects pollution by its appearance after a test run, so the
# artifact must be absent before the scan starts.
if [ -e "$POLLUTION_CHECK" ]; then
  echo "❌ $POLLUTION_CHECK already exists before any test ran."
  echo "   Remove it first, then re-run this script."
  exit 2
fi

echo "🔍 Searching for test that creates: $POLLUTION_CHECK"
echo "Test pattern: $TEST_PATTERN"
echo "Test runner: $TEST_RUNNER"
echo ""

# Get list of test files (find . emits ./-prefixed paths, so accept the
# pattern written with or without a leading ./)
TEST_PATTERN="${TEST_PATTERN#./}"
# find -path can't match '**/' against zero directory levels, so a pattern
# like src/**/*.test.ts would skip src/top.test.ts; also try the pattern
# with '**/' collapsed to cover files directly under the base directory.
TEST_FILES=$(find . \( -path "./$TEST_PATTERN" -o -path "./${TEST_PATTERN//\*\*\//}" \) | sort -u)
if [ -z "$TEST_FILES" ]; then
  TOTAL=0
else
  TOTAL=$(printf '%s\n' "$TEST_FILES" | wc -l | tr -d ' ')
fi

echo "Found $TOTAL test files"
echo ""

COUNT=0
while IFS= read -r TEST_FILE; do
  [ -n "$TEST_FILE" ] || continue
  COUNT=$((COUNT + 1))

  echo "[$COUNT/$TOTAL] Testing: $TEST_FILE"

  # Run the test (unquoted expansion is intentional: the runner may be
  # a multi-word command like 'npx vitest run')
  $TEST_RUNNER "$TEST_FILE" > /dev/null 2>&1 || true

  # Check if pollution appeared
  if [ -e "$POLLUTION_CHECK" ]; then
    echo ""
    echo "🎯 FOUND POLLUTER!"
    echo "   Test: $TEST_FILE"
    echo "   Created: $POLLUTION_CHECK"
    echo ""
    echo "Pollution details:"
    ls -la "$POLLUTION_CHECK"
    echo ""
    echo "To investigate:"
    echo "  $TEST_RUNNER $TEST_FILE    # Run just this test"
    echo "  cat $TEST_FILE         # Review test code"
    exit 1
  fi
done <<< "$TEST_FILES"

echo ""
echo "✅ No polluter found - all tests clean!"
exit 0
