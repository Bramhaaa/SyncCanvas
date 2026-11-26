---
name: refresh
description: >-
  Re-analyze the repository and rebuild stale persistent memory after major
  refactors or structural changes while preserving session history. Use when
  the user runs /refresh or memory has drifted from the codebase.
---

# Refresh Workflow

## Purpose
Rebuild the agent's understanding of the repository when the project has changed enough that existing memory may be stale.

## Steps to Execute
1. Read `.agent/AGENT.md` and the current `.agent/memory/` files (`overview.md`, `architecture.md`, `index.md`, `current.md`, `decisions.md`).
2. Re-inspect the repository, focusing on changed areas and high-level structure.
3. Compare repository evidence against memory to identify stale or missing facts.
4. Update only the affected memory files:
   - `.agent/memory/overview.md` (if description, stack, or maturity changed)
   - `.agent/memory/architecture.md` (if architecture or data flow changed)
   - `.agent/memory/index.md` (if the semantic feature/file map changed; keep under ~150 lines)
   - `.agent/memory/current.md` and `.agent/memory/roadmap.md` (if state/progress changed)
   - `.agent/memory/decisions.md` (append new durable decisions if any)
5. Append a brief refresh note to `.agent/memory/sessions/YYYY-MM-DD.md` while preserving all prior history.

## Rules to Follow
- Update only what is verified to be stale against actual code.
- Keep `index.md` semantic (features/responsibilities), never a raw directory tree.
- Never rewrite historical session logs or prior decisions.
