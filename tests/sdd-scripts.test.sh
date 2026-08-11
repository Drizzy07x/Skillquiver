#!/usr/bin/env bash
set -euo pipefail

repo_root=$(cd "$(dirname "$0")/.." && pwd)
scripts="$repo_root/.claude/skills/subagent-driven-development/scripts"
test_root=$(mktemp -d)
trap 'rm -rf "$test_root"' EXIT

work="$test_root/repo"
git init -q "$work"
git -C "$work" config user.name "Skillquiver Tests"
git -C "$work" config user.email "tests@example.com"
git -C "$work" config core.autocrlf false
mkdir -p "$work/docs/plans"

cat > "$work/docs/plans/example.md" <<'PLAN'
# Example Plan

### Task 1: First task

Required opening text.

#### Nested requirements

This nested section must remain in the brief.

```markdown
### Task 99: This fenced heading is content
```

### Task 2: Second task

This task must not appear in Task 1's brief.
PLAN

printf 'first\n' > "$work/example.txt"
git -C "$work" add .
git -C "$work" commit -qm "test: add fixture"
base=$(git -C "$work" rev-parse HEAD)
printf 'second\n' >> "$work/example.txt"
git -C "$work" add example.txt
git -C "$work" commit -qm "test: update fixture"
head=$(git -C "$work" rev-parse HEAD)

cd "$work"
bash "$scripts/task-brief" docs/plans/example.md 1 >/dev/null
brief="$work/.skillquiver/sdd/example/task-1-brief.md"
grep -q 'Nested requirements' "$brief"
grep -q 'Task 99: This fenced heading is content' "$brief"
if grep -q 'Second task' "$brief"; then
  echo 'task-brief included the next task' >&2
  exit 1
fi

bash "$scripts/review-package" docs/plans/example.md "$base" "$head" >/dev/null
base_short=$(git rev-parse --short "$base")
head_short=$(git rev-parse --short "$head")
package="$work/.skillquiver/sdd/example/review-${base_short}..${head_short}.diff"
grep -q 'test: update fixture' "$package"
grep -q '^+second$' "$package"

echo 'SDD script tests passed'
