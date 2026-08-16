# Codex instruction scopes

Use this reference only for Codex targets. It separates documented behavior
from local policy. The documented baseline is
<https://developers.openai.com/codex/guides/agents-md>; verify it live when
available and label any local policy as such.

## Discovery and inventory

- Resolve `$CODEX_HOME`, defaulting to `~/.codex`, and record configuration
  sources and physical paths after resolving links.
- For global guidance, select the first non-empty `AGENTS.override.md` then
  `AGENTS.md`. Report candidates as selected, shadowed, empty, and truncated.
- For project guidance, walk from the project root through cwd. At each level,
  select `AGENTS.override.md`, then `AGENTS.md`, then configured
  `project_doc_fallback_filenames`.
- Merge selected project files root-first. Guidance nearer cwd wins on conflict.
- Apply the default 32 KiB project budget unless the top-level Codex
  configuration sets `project_doc_max_bytes`; record truncation and configured
  fallback names.
- If Git does not resolve a project root, use cwd fallback as the project root
  and disclose that fallback.

`AGENTS.md` is self-contained: documented behavior does not define Claude-style
`@path` imports. Local policy may choose nested instruction files for genuinely
local rules, but it must not be presented as documented loading behavior.

## Safe verification

Use read-only fresh-session probes after an authorized edit, for example:

```text
codex --ask-for-approval never "Summarize active instruction sources in load order."
codex --cd <nested-directory> --ask-for-approval never "List active instruction sources."
```

Verify source order, not merely file presence. If a probe is unavailable, mark
runtime loading unverified and retain static verification separately.
