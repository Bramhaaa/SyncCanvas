---
name: shutdown
description: >-
  Close a work session by verifying actual repository changes and updating
  affected persistent memory files so the next session can resume accurately.
  Use when the user runs /shutdown or pauses/finishes work.
---

# Shutdown Workflow

## Purpose
Capture the outcome of the current work session and update persistent memory so the next session can resume accurately via `/start`.

## Steps to Execute
1. Review the current conversation for work discussed and completed.
2. Inspect actual repository state (`git status`, `git diff`, modified/new/deleted files) rather than relying only on conversation history.
3. Determine which memory files are affected by the verified changes:
   - `.agent/memory/current.md` (always update)
   - `.agent/memory/sessions/YYYY-MM-DD.md` (append concise session summary; never overwrite historical notes)
   - `.agent/memory/decisions.md` (append only if new durable architectural decisions were made)
   - `.agent/memory/index.md` (update only if project structure or module map changed)
   - `.agent/memory/roadmap.md` (update only if task/gate progress changed)
   - `.agent/memory/known_issues.md` (update only if confirmed issues appeared or were resolved)
4. Update only the affected files; leave unchanged memory untouched.
5. Provide a concise end-of-session summary and clear next-step handoff.

## Rules to Follow
- Verify the final state against the repository before summarizing.
- Never overwrite historical session notes or decisions.
- Do not make unrelated code changes during shutdown.
