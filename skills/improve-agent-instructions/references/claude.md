# Claude Code instruction scopes

Use this reference only for Claude Code targets. Verify current documented
behavior at <https://code.claude.com/docs/en/memory> when available, and label
the inspector's local-policy assumptions separately.

## Sources and order

- Managed OS locations are `C:\Program Files\ClaudeCode` on Windows,
  `/Library/Application Support/ClaudeCode` on macOS, and `/etc/claude-code` on
  Linux. Their `CLAUDE.md` and managed `claudeMd` settings are report-only.
- Resolve `CLAUDE_CONFIG_DIR` before falling back to `~/.claude` for user
  guidance. Record logical and resolved paths.
- Within-directory order is `CLAUDE.md`, `.claude/CLAUDE.md`, and
  `CLAUDE.local.md` where applicable; broader directories load before cwd.
- Parse imports only outside code spans and fenced blocks. Allow four-hop
  imports; require external approval before treating an external import as
  editable.
- Inventory user and project recursive rules, including `.claude/rules/**/*.md`.
  Preserve a rule's `paths` conditions and do not promote conditional rules to
  always-loaded guidance.
- Read managed, user, project, and local setting sources. Apply excludes,
  setting sources, and additional directories only as configured; report
  ambiguity or unknown settings instead of inventing values.

For a dual-host project, root `CLAUDE.md` imports `@AGENTS.md`, or
`.claude/CLAUDE.md` imports `@../AGENTS.md`, followed only by Claude-specific
deltas. Never use an import as evidence that Codex loads it.

## Safe verification

Use safe `/context` and `/memory` verification boundaries in a fresh Claude
Code session: inspect reported memory sources and configuration, then enter a
nested scope or read a matching file before checking conditional guidance. Do
not infer runtime loading from file presence. If the host cannot run, report
static structure as verified and runtime loading as unverified.
