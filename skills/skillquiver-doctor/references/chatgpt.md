# ChatGPT inventory and repair

Use only for a running ChatGPT session.

## Capability check

Before inventorying, record which of these the current ChatGPT surface exposes:

- the active plugin and bundled skill metadata;
- a read-only view of installed plugins in the Plugins Directory;
- covered local filesystem skill roots in a Work or desktop task;
- persistent instruction or automation settings owned by ChatGPT.

Do not infer a source from the product name or from another client. If a source
cannot be inspected, record a coverage gap and do not produce a finding from
that source. Do not inspect Claude Code or Codex configuration as a fallback.

## Read-only inventory

Inventory only the sources the current ChatGPT session actually exposes:

- the active Skillquiver package identity and its bundled skill names and
  descriptions;
- other installed or enabled plugins shown by ChatGPT's plugin controls;
- local filesystem skills only from roots explicitly exposed by the current
  Work or desktop task;
- persistent ChatGPT instructions only when the active surface provides a
  supported read-only view.

Do not inspect browser cookies, storage, account files, hidden client state, or
uninstalled plugin caches. Treat a second source as foreign only when its
canonical identity or path is observable and differs from the active package.
An unavailable inventory source is a coverage limitation, not evidence of a
conflict.

Skillquiver Doctor disables implicit invocation. In ChatGPT, the user must
select it explicitly with the `@` skill picker. Its absence from automatic
routing is expected and is not a missing-skill finding.

## Reversible actions

- Plugin: offer **Remove in ChatGPT** or **Keep**. Use only the supported
  ChatGPT plugin control after a separate confirmation for that plugin. Do not
  substitute a CLI from another host.
- Local filesystem skill: offer **Move to backup** or **Keep** only when the
  exact source path and a user-approved backup destination are available.
- Persistent ChatGPT instruction: offer the smallest supported UI change or
  **Keep**. Never edit opaque application state or another host's settings.

If ChatGPT exposes no reversible control for a demonstrated finding, report it
as manual and identify the owning control surface. Do not improvise a repair.

## Verification

Re-run the same observable inventory after every approved action. Start a new
ChatGPT conversation when required for plugin or skill changes to take effect,
then verify the installed plugin and expected skills through the same supported
surface. Keep every uninspectable source listed as a coverage gap.
