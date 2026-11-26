---
name: checkpoint
description: >-
  Save current working state to persistent memory mid-session without closing
  the session. Use when the user runs /checkpoint or wants to preserve progress
  after a meaningful unit of work or before switching tasks.
---

# Checkpoint Workflow

## Purpose
Save the current working state during an active session so progress is preserved without closing the session.

## Steps to Execute
1. Read `.agent/memory/current.md` and today's session log (`.agent/memory/sessions/YYYY-MM-DD.md`, creating it from `.agent/templates/session.md` if needed).
2. Verify what was actually completed in the repository since the last checkpoint (`git status` / `git diff` if Git is initialized).
3. Update `.agent/memory/current.md` with the current feature state, completed work, blockers, branch, and immediate next action.
4. Append a short checkpoint note to today's session log.
5. Leave `overview.md`, `architecture.md`, and `index.md` untouched unless a verified structural change occurred.
6. Resume work or hand control back to the user.

## Rules to Follow
- Keep checkpoint updates short and factual.
- Do not rewrite untouched memory files.
- Preserve existing session history instead of overwriting it.
