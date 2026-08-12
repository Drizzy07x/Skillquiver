#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

mkdir -p \
  "$work/bin" \
  "$work/home/.codex" \
  "$work/workspace/.agents/plugins" \
  "$work/workspace/plugins/Skillquiver/.codex-plugin"

cat > "$work/workspace/.agents/plugins/marketplace.json" <<'EOF'
{
  "name": "plugin-eval-benchmark",
  "plugins": [
    {
      "name": "Skillquiver",
      "source": {
        "source": "local",
        "path": "./plugins/Skillquiver"
      }
    }
  ]
}
EOF

cat > "$work/workspace/plugins/Skillquiver/.codex-plugin/plugin.json" <<'EOF'
{
  "name": "manifest-plugin"
}
EOF

cat > "$work/bin/codex" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$*" >> "$FAKE_CODEX_LOG"
if [[ "${1:-}" == "--version" ]]; then
  printf 'codex-cli fake-test\n'
fi
EOF
chmod +x "$work/bin/codex"

export CODEX_HOME="$work/home/.codex"
export FAKE_CODEX_LOG="$work/codex.log"
export PATH="$work/bin:$PATH"

bash "$repo_root/benchmarks/codex-with-local-plugin.sh" --version >/dev/null
grep -Fx -- '--version' "$FAKE_CODEX_LOG" >/dev/null

: > "$FAKE_CODEX_LOG"
bash "$repo_root/benchmarks/codex-with-local-plugin.sh" \
  exec --cd "$work/workspace" --json 'safe prompt'

grep -Fx -- "plugin marketplace add $work/workspace --json" "$FAKE_CODEX_LOG" >/dev/null
grep -Fx -- 'plugin add manifest-plugin@plugin-eval-benchmark --json' "$FAKE_CODEX_LOG" >/dev/null
grep -Fx -- "exec --cd $work/workspace --json safe prompt" "$FAKE_CODEX_LOG" >/dev/null
grep -F '"name": "manifest-plugin"' \
  "$work/workspace/.agents/plugins/marketplace.json" >/dev/null

set +e
bash "$repo_root/benchmarks/codex-with-local-plugin.sh" exec --json 'safe prompt' \
  >"$work/missing-cd.stdout" 2>"$work/missing-cd.stderr"
status=$?
set -e

[[ "$status" -eq 2 ]]
grep -F 'could not resolve the Codex workspace' "$work/missing-cd.stderr" >/dev/null

printf 'benchmark wrapper tests passed\n'
