#!/usr/bin/env bash
set -euo pipefail

codex_bin="$(command -v codex || true)"
if [[ -z "$codex_bin" ]]; then
  printf 'codex was not found on PATH.\n' >&2
  exit 1
fi

arguments=("$@")
if [[ "${arguments[0]:-}" == "exec" ]]; then
  workspace=""
  for ((index = 0; index < ${#arguments[@]}; index += 1)); do
    if [[ "${arguments[$index]}" == "--cd" ]] && ((index + 1 < ${#arguments[@]})); then
      workspace="${arguments[$((index + 1))]}"
      break
    fi
  done

  if [[ -z "$workspace" ]]; then
    printf 'Benchmark wrapper could not resolve the Codex workspace.\n' >&2
    exit 2
  fi

  marketplace_file="$workspace/.agents/plugins/marketplace.json"
  plugin_name="$(node - "$marketplace_file" "$workspace" <<'NODE'
const fs = require('node:fs');
const path = require('node:path');

const marketplacePath = process.argv[2];
const workspace = process.argv[3];
const marketplace = JSON.parse(fs.readFileSync(marketplacePath, 'utf8'));
const plugin = marketplace.plugins[0];
const manifestPath = path.resolve(
  workspace,
  plugin.source.path,
  '.codex-plugin',
  'plugin.json',
);
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
plugin.name = manifest.name;
fs.writeFileSync(marketplacePath, `${JSON.stringify(marketplace, null, 2)}\n`);
process.stdout.write(manifest.name);
NODE
)"
  "$codex_bin" plugin marketplace add "$workspace" --json >/dev/null
  "$codex_bin" plugin add "$plugin_name@plugin-eval-benchmark" --json >/dev/null
fi

timeout_seconds="${SKILLQUIVER_BENCHMARK_TIMEOUT_SECONDS:-}"
if [[ "$timeout_seconds" =~ ^[1-9][0-9]*$ ]]; then
  set +e
  timeout --signal=TERM --kill-after=5s "${timeout_seconds}s" \
    "$codex_bin" "${arguments[@]}"
  status=$?
  set -e
  if [[ "$status" -eq 124 ]]; then
    printf 'Codex benchmark timed out after %s seconds.\n' "$timeout_seconds" >&2
  fi
  exit "$status"
fi

exec "$codex_bin" "${arguments[@]}"
