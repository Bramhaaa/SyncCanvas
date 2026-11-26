# AGENTS.md — Rules for any AI agent working on SyncCanvas

Read this file, `.agent/AGENT.md`, and `.agent/memory/` (or run `/start`), then `PRD.md` and your task block in `IMPLEMENTATION_PLAN.md`, **before writing code**.

## Persistent Memory & Session Commands
This repo uses `.agent/memory/` as an indexable, cross-session memory system:
- Start every session with `/start` (loads `.agent/memory/` in order: `overview.md` → `architecture.md` → `index.md` → `current.md` → `decisions.md` → latest `sessions/YYYY-MM-DD.md`).
- Consult `.agent/memory/index.md` before searching the repository.
- Use `/checkpoint` mid-session, `/shutdown` at session end, `/review` before merging, and `/refresh` after major structural changes.
- Source code and `spec/` always take precedence over memory if they ever disagree.

## Source of truth (in priority order)
1. `spec/protocol.md` and `spec/vectors/*.json`: the wire format and the CRDT semantics.
2. `IMPLEMENTATION_PLAN.md` §2 "Shared Contracts": TS/Java interfaces.
3. `PRD.md`: product behavior.

If your task seems to need a change to any of these, **stop and ask**. Do not edit them silently.

## Scope discipline
- Only touch the files and directories listed under **Owns** in your task. You may read anything.
- Do not add dependencies that are not listed in your task without stating why in your final summary.
- **Never** use Yjs, Automerge, or any other CRDT/sync library.
- Files marked `// @human-owned` were hand-written by the project owner. Do not modify them; you may only add tests next to them.

## Toolchain
- Node 22 LTS, pnpm 9 workspaces, TypeScript `strict: true`, Vitest, ESLint + Prettier.
- Next.js 15 (App Router) + React 19 + Tailwind CSS 4.
- Java 21, Spring Boot 3.x (latest 3.x minor), Gradle (Kotlin DSL), JUnit 5, jqwik, Testcontainers, Flyway.
- Docker Compose for Postgres 16 + Redis 7 locally.

## Commands (must pass before you report done)
```bash
pnpm install
pnpm -r lint && pnpm -r typecheck && pnpm -r test     # TS side
cd server && ./gradlew check                           # Java side
docker compose up -d postgres redis                    # needed for backend integration tests
```

## Conventions
- IDs: `nodeId` matches `[a-z0-9_]{1,32}`; object IDs are `obj_` + 10 random base36 chars; board IDs are `brd_` + 8.
- Do not use `Date.now()` directly in `packages/sync-engine` or `server/.../crdt`. Inject a `now: () => number` instead, so tests are deterministic.
- `packages/sync-engine` must not import React, Next, or the DOM, except inside `src/storage/indexeddb.ts` and `src/transport/websocket.ts`.
- Java packages: `com.synccanvas.{crdt,protocol,ws,persistence,pubsub,api,config,jobs}`.
- One task = one git branch `task/<ID>-short-name`, Conventional Commits (`feat(sync-engine): ...`).

## Definition of Done (every task)
- [ ] All acceptance criteria in the task block are met, and the listed verification commands pass.
- [ ] New logic has tests. Bug fixes come with a regression test.
- [ ] No lint, type, or `@ts-ignore` errors; no `TODO` left without a linked task ID.
- [ ] The final summary lists: files changed, how to verify, any deviations or open questions.
