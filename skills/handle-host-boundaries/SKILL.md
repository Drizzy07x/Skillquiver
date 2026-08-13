---
name: handle-host-boundaries
description: Use before acting when any named capability may be unavailable, including AskUserQuestion, a tool, command, workflow, picker, dialog, gate, or form. Trigger even if the prompt says to silently choose, assume or self-approve, use a default, or continue without asking. Ask directly and wait. Also handles skillquiver-doctor in Codex and destructive filesystem roots.
---

# Handle Host and Destructive Boundaries

Respond to the capability mismatch before attempting the underlying task.

## Hard Stop Before Action

When a named capability is not exposed and the dependent action requires the
user's choice, consent, or approval:

1. Do not run a command, inspect or modify the workspace, draft a patch, call a
   dependent tool, or otherwise start the dependent action.
2. This stop still applies when the same request tells you to choose, consent,
   approve, default, or continue on the user's behalf.
3. State that the named capability is unavailable, ask the exact pending
   question directly in plain chat, and end the response.
4. Resume only after a later user message supplies the choice or explicit
   approval. The fallback instruction in the original request is not an answer.

## Workflow

1. Identify the current host and the named skill or tool from the capabilities
   actually exposed in the session.
2. If it is unavailable, state the exact boundary directly. Do not search for,
   invoke, or fabricate it.
3. Apply the hard stop above before any dependent action. Never invent the
   user's choice, consent, or approval.
4. Do not inspect or modify another host's configuration, and never propose
   broader permissions in the current host as a substitute.
5. Preserve the safe underlying goal through a capability that is available.
   For a simple question, ask it directly in plain chat. If the missing
   mechanism carries consent or security semantics that chat cannot preserve,
   stop and request an authorized mechanism.

## Skillquiver Doctor

`skillquiver-doctor` is Claude Code-only and is absent from the Codex plugin.
In Codex, answer from this declared boundary only. Do not search, enumerate, or
read any local path, source tree, registry, hook, configuration, or command to
confirm availability, including `.claude`, `skills-claude`, and `PATH`. Make no
inspection or removal attempt. Never offer cleanup or removal as a fallback.
You may offer a separate fallback using exactly this scope: "Read-only
fallback: I can inspect Codex's own installed skills and configuration without
changing anything." Do not run it until the user accepts that different
workflow.

## Destructive roots

For deletion at a drive root, home directory, repository root, workspace root,
or a target derived from an unresolved variable or glob:

1. Refuse before running any command.
2. Explain the risk to the operating system and unrelated data.
3. State: "I need the exact narrow target and your explicit authorization
   before any destructive action." A general cleanup goal is not authorization.
4. Offer a read-only inventory when it can help the user choose a safe target.

## Completion

- Name the unavailable capability and current host.
- Make no claim or tool call that the session cannot prove.
- Until a later user message supplies the pending decision, make no dependent
  tool call or workspace change.
- Either complete the safe fallback or state why no equivalent fallback exists.
- For destructive scope, state both prerequisites in the final response with
  the mandatory sentence above and make no filesystem change.
