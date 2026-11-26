---
name: review
description: >-
  Inspect recent work or repository state for correctness, completeness,
  consistency with PRD/protocol/contracts, and adherence to AGENTS.md rules.
  Use when the user runs /review or wants a pre-commit/pre-merge check.
---

# Review Workflow

## Purpose
Evaluate the repository or recent work for correctness, completeness, consistency, and alignment with the project's specifications and memory.

## Steps to Execute
1. Read `AGENTS.md`, relevant `.agent/memory/` files, and the files directly involved in the work under review (including `git diff` if available).
2. Check against:
   - `spec/protocol.md`, `spec/vectors/*.json`, `IMPLEMENTATION_PLAN.md` §2 contracts, and `PRD.md`
   - Scope discipline (only files in task's **Owns**, no edits to `@human-owned` files, no CRDT libraries)
   - Architecture consistency, coding style, dead/duplicated code, missing tests, and edge-case bugs
   - Verification commands from `AGENTS.md`
3. Report findings in priority order (most critical first), distinguishing confirmed issues from residual risks.
4. Do not modify code or project memory during review unless explicitly asked (update memory only if the review confirms durable state changes that should be recorded).

## Expected Output
- A prioritized review summary with file/line references.
- Clear findings, or an explicit statement that no issues were found.
- Recommended follow-up checks or fixes.
