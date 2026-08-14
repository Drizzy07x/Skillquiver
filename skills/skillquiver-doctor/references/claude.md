# Claude Code inventory and repair

Use only for a running Claude Code session.

## Read-only inventory

Resolve home and cwd to absolute paths once. Inventory:

- personal skills under `~/.claude/skills/*/SKILL.md`;
- project skills under `<cwd>/.claude/skills/*/SKILL.md`;
- installed plugin records in
  `~/.claude/plugins/installed_plugins.json` and their `installPath` skill
  directories;
- hooks in user, project, and local `settings.json` files;
- plugin hooks resolved from each plugin manifest;
- the session skill listing only as corroboration.

Read `name` and `description` first. Load a body or hook only when the common
classification contract requires it. Treat the active Skillquiver install,
its development install, and this repository's `skills/` directory as self.
Report plugin caches and managed settings without editing them.

## Reversible actions

Use one backup directory per run:
`~/.claude/skillquiver-doctor-backup/<YYYYMMDD-HHmmss>/`.

- Standalone skill: offer **Move to backup** or **Keep**, preserve its relative
  path, and verify the move.
- Plugin: offer **Uninstall**, **Disable**, or **Keep**. Use
  `claude plugin uninstall <name@marketplace>` or
  `claude plugin disable <name@marketplace>`; never delete its cache.
- Settings-owned hook: copy the complete settings file into the backup and
  remove only the confirmed entry.
- Plugin-owned hook: disable or uninstall the plugin, or keep it; never patch
  the cache.

## Verification

Re-run the inventory and `claude plugin list`, verify the exact backup
contents, confirm approved hook entries are absent, and tell the user to
restart Claude Code.
