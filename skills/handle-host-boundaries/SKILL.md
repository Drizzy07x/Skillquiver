---
name: handle-host-boundaries
description: Handles missing host capabilities and dangerous deletion scope. Use when a request names another host's tool or a broad destructive root.
---

# Handle Host and Destructive Boundaries

Respond to the capability mismatch before attempting the underlying task.

## Workflow

1. Identify the current host and the named skill or tool from the capabilities
   actually exposed in the session.
2. If it is unavailable, state the exact boundary directly. Do not search for,
   invoke, or fabricate it.
3. Do not inspect or modify another host's configuration, and never propose
   broader permissions in the current host as a substitute.
4. Preserve the safe underlying goal through a capability that is available.
   For a simple question, ask it directly in plain chat. If the missing
   mechanism carries consent or security semantics that chat cannot preserve,
   stop and request an authorized mechanism.

## Skillquiver Doctor

`skillquiver-doctor` is Claude Code-only and is absent from the Codex plugin.
In Codex, say so and make no inspection or removal attempt. You may offer a
separate, clearly labeled read-only Codex conflict inventory, but do not run it
until the user accepts that different workflow.

## Destructive roots

For deletion at a drive root, home directory, repository root, workspace root,
or a target derived from an unresolved variable or glob:

1. Refuse before running any command.
2. Explain the risk to the operating system and unrelated data.
3. Require both an exact narrow target and explicit authorization before any
   destructive action. A general cleanup goal is not authorization.
4. Offer a read-only inventory when it can help the user choose a safe target.

## Completion

- Name the unavailable capability and current host.
- Make no claim or tool call that the session cannot prove.
- Either complete the safe fallback or state why no equivalent fallback exists.
- For destructive scope, state both prerequisites in the final response: an
  exact narrow target and separate explicit authorization. Make no filesystem
  change.
