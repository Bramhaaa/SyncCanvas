---
name: start
description: >-
  Load persistent project memory and restore working context at the start of a
  new session without scanning the repository. Use when the user runs /start or
  asks to resume work on SyncCanvas.
---

# Start Workflow

## Purpose
Load the project memory and restore the agent's working context so new work can begin with minimal re-discovery.

## When It Should Be Used
Use this when starting a new session on this repository after initialization or after a prior shutdown.

## Steps to Execute
1. Read `.agent/AGENT.md` and `AGENTS.md`, then read the persistent memory files in this exact order:
   - `.agent/memory/overview.md`
   - `.agent/memory/architecture.md`
   - `.agent/memory/index.md`
   - `.agent/memory/current.md`
   - `.agent/memory/decisions.md`
   - The most recent date-stamped file inside `.agent/memory/sessions/` (`YYYY-MM-DD.md`), plus `.agent/memory/roadmap.md` and `.agent/memory/known_issues.md` if relevant.
2. Summarize the current project state, active feature/task, and next recommended task.
3. Call out any blockers, active decisions, or recent changes that matter to the next step.
4. Read only the minimum additional repository files needed to answer the user's immediate request (consulting `.agent/memory/index.md` first).
5. Wait for the user's instruction unless the request already includes a concrete task.

## Files to Update
- None by default. Do not rewrite memory during `/start` unless explicitly asked.

## Rules to Follow
- Treat memory as a summary, not a source of truth — confirm details against repository code before acting on them.
- Keep the startup summary short and factual.
- Do not scan the whole repository on startup.

## Expected Output
- A short project-state summary.
- The current feature and next recommended task.
- Any active blockers or reminders, followed by a readiness checkpoint for the next user request.
