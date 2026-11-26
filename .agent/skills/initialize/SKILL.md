---
name: initialize
description: >-
  Perform one-time repository analysis to create the persistent memory baseline
  under .agent/memory/. Use when the user runs /initialize or memory files are
  missing/empty.
---

# Initialize Workflow

## Purpose
Set up the agent's long-term working context for a repository by analyzing the project and creating the persistent memory files that future sessions will rely on.

## Steps to Execute
1. Read `.agent/AGENT.md` and `AGENTS.md`, and check existing files in `.agent/memory/`.
2. Inspect the repository at a high level to identify purpose, technologies, architecture, key folders, and workflows.
3. Populate `.agent/memory/` using the structures in `.agent/templates/`:
   - `overview.md`
   - `architecture.md`
   - `index.md` (semantic map, never a directory tree)
   - `current.md`
   - `decisions.md`
   - `roadmap.md`
   - `known_issues.md`
4. Create today's session log in `.agent/memory/sessions/YYYY-MM-DD.md`.
5. Stop after initialization and wait for user review before writing implementation code.

## Rules to Follow
- Base every fact on repository evidence — never invent details or placeholders.
- Keep memory concise and high-signal; do not copy large code snippets.
