# Codex inventory and repair

Use only for a running Codex session.

## Read-only inventory

Resolve home and cwd to absolute paths once. Inventory:

- user-installed skills under `$CODEX_HOME/skills/*/SKILL.md`, where
  `$CODEX_HOME` defaults to `~/.codex`, excluding `.system`;
- bundled skills under `$CODEX_HOME/skills/.system` as a report-only source;
- repository skills under every `.agents/skills` directory from cwd through
  the repository root;
- `/etc/codex/skills` when readable, as an administrator-owned report-only
  source;
- installed plugins from `codex plugin list --json`, resolving local
  `source.path` values and recording metadata-only plugins whose source cannot
  be read;
- user and repository hooks in `.codex/hooks.json` and `.codex/config.toml`;
- hooks bundled by installed plugins through their manifest or default
  `hooks/hooks.json` path;
- the session skill listing only as corroboration, never as the sole finding.

Keep the inventory to at most 12 read-only tool calls. Batch compatible path
checks and metadata reads, use the documented commands directly without help
probes, and stop once every source above has a recorded result. Do not recurse
through the workspace, system skill bodies, marketplace roots, or plugin cache.

Read `name` and `description` first. Load a skill body or hook command only to
decide a fork or Class C conflict. Report unreadable skills, dangling links,
and malformed configuration without repairing them automatically.

Resolve the active `skillquiver` plugin's selector and canonical source path.
Treat only that source, exact development-source aliases, and cache or runtime
views that resolve back to it as self. Do not report metadata or visibility
differences among those exact views, and never propose removing the active
source. A second plugin or standalone Skillquiver source that resolves to a
different canonical path is foreign; evaluate its duplicate names under Class A
and offer repair only for that foreign source.

Skillquiver Doctor sets `allow_implicit_invocation` to `false`. Codex therefore
does not inject it into the default session skill catalog, but it can still be
invoked explicitly via `$skillquiver:skillquiver-doctor`. Its absence from the implicit
catalog is expected and is not a missing-skill finding.

`requirements.toml` and other managed configuration are report-only. Plugin
caches are also report-only and must never be edited directly. Do not traverse uninstalled plugin caches during the conflict inventory. Inspect an installed
plugin only through the exact source path returned by `codex plugin list --json`.

## Reversible actions

Use one backup directory per run:
`~/.codex/skillquiver-doctor-backup/<YYYYMMDD-HHmmss>/`.

- Standalone skill: offer **Move to backup** or **Keep**. Preserve the relative
  source path under the backup, then verify source absent and destination
  present.
- Plugin: offer **Uninstall** or **Keep**. For an approved uninstall, run
  `codex plugin remove <plugin@marketplace> --json` using the exact selector
  returned by `codex plugin list --json`. Do not edit the plugin cache. If the
  user wants disable instead, direct them to `/plugins` and wait for the manual
  action because Codex has no stable disable CLI command.
- User or repository hook: offer **Remove this handler** or **Keep**. Copy the
  complete owning file into the backup, remove only the confirmed handler, and
  remove an empty matcher group only when that handler was its last member.
- Plugin-owned hook: uninstall the owning plugin or keep it; never patch its
  cache.

## Verification

- Parse an edited `hooks.json` as JSON.
- After editing `config.toml`, run `codex features list` to confirm Codex can
  load the configuration.
- Re-run `codex plugin list --json` after an uninstall.
- Re-run the complete inventory, verify exact backup contents, and tell the
  user to restart Codex or begin a new task.
