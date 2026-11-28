# SyncCanvas — Architectural Decisions

Append new decisions chronologically. Never rewrite history.

## 2026-11-26 — Core Sync Protocol & Architecture Baseline (PRD v1.1)
- **Context:** Initial PRD v1.0 had protocol gaps (no ack for origin client, global `BIGSERIAL` commit-order skew, no gap detection over best-effort Redis Pub/Sub, no `SNAPSHOT_REQUIRED` path, vague HLC receive/skew handling, sleeping free-tier hosting).
- **Decisions Made:**
  1. **Origin-included `SYNC_BROADCAST` as ack:** Origin receives its own broadcast to safely clear its outbox and advance `lastSyncedSeq`; idempotent merge makes re-apply a no-op.
  2. **Per-board gap-free sequencing:** `UPDATE boards SET next_seq = next_seq + :n RETURNING next_seq` inside the write transaction replaces global `BIGSERIAL`, guaranteeing seq order == commit order without cross-board contention.
  3. **Client gap detection + `SNAPSHOT_REQUIRED`:** Clients buffer out-of-order seqs and issue `SYNC_PULL`. Clients behind pruned ops fetch and **merge** (never replace) the compacted snapshot.
  4. **Strict HLC spec:** 5-digit counter with overflow carry, Kulkarni et al. 4-branch receive rule, and server clock-skew guard (`MAX_DRIFT_MS = 60_000`).
  5. **Cross-language hash parity:** RFC 8785 JCS canonicalization (`canonicalize` in TS, `java-json-canonicalization` in Java) + SHA-256 over sorted registers.
  6. **Frontend framework:** Next.js 15 (App Router) retained per owner preference, with strict client-only boundary (`"use client"` + `ssr: false`) for canvas/IndexedDB/WebSocket and framework-agnostic `packages/sync-engine`.
  7. **Always-on backend hosting:** Single VM running Docker Compose (Caddy + 2× Spring Boot + Redis) + Neon Postgres in the same region, avoiding cold starts on free PaaS tiers.
- **Consequences:** All tasks in `IMPLEMENTATION_PLAN.md` code against these frozen contracts; `spec/protocol.md` and `spec/vectors/*.json` will enforce TS/Java parity in CI.

## 2026-11-26 — Persistent Agent Memory & Slash-Command Skills
- **Context:** Owner wants indexable, session-persistent memory modeled after `~/Developer/Personal/Agents` with a `/start` command to restore context cleanly in any new session.
- **Decisions Made:** Adopted `.agent/memory/` (8 standard files + `sessions/`), `.agent/templates/`, `.agent/AGENT.md`, and exposed the 6 lifecycle workflows as Antigravity skills under `.agent/skills/<name>/SKILL.md` (`/start`, `/checkpoint`, `/shutdown`, `/refresh`, `/review`, `/initialize`).
- **Consequences:** Any new session can run `/start` to load memory in order without scanning the repo, and `/checkpoint` or `/shutdown` to persist state.

## 2026-11-26 — T01 Protocol Hardening & Repo Workflow Adjustments
- **Context:** During T01 protocol review, 4 convergence/protocol edge cases were identified, and the owner adjusted repo workflow preferences.
- **Decisions Made:**
  1. **Server-only clock-skew enforcement:** Clients always merge ops received in `SYNC_BROADCAST`; if local `clock.receive()` throws `ClockSkewError`, clients catch it, leave local clock unchanged, and still apply the op so replicas never diverge.
  2. **Per-op acks by HLC `nodeId`:** Clients ack any broadcast op whose HLC `nodeId` matches their own; `originClientId` is informational only (catch-up pages set it to `"server"`).
  3. **Server field validation & atomic frames:** `type` is write-once; type is resolved from earlier ops in the same frame then board state; frames are accepted/rejected atomically with `ERROR.rejectedHlcs`; catch-up pages are capped at 500 ops or 256 KiB; `/ops` returns `410 Gone` for pruned seqs.
  4. **Workflow:** Commit directly to `main` (no per-task feature branches); `.agent/` and `AGENTS.md` are kept local-only and excluded via `.gitignore`.
- **Consequences:** `spec/protocol.md`, `spec/schema/*.json`, `PRD.md` (errata), and `IMPLEMENTATION_PLAN.md` (T22) are aligned; Week 1 (`T00`–`T08`) passes all TS and Java parity checks.

## 2026-11-28 — Git Tracking of `.agent/`, Multi-Node Cache Sync, CRDT Undo, and Student Deployment
- **Context:** Owner opted to track `.agent/` and `AGENTS.md` in git for portability, requested a complete-product audit pass after Weeks 3–6, and asked for zero-cost student deployment options.
- **Decisions Made:**
  1. **Track `.agent/` and `AGENTS.md` in git:** Removed both from `.gitignore` so session memory and skills persist across machines.
  2. **Multi-node `BoardStateService` cache consistency:** `SessionRegistry.onOps` feeds remote Redis broadcasts into `BoardStateService.applyRemoteBroadcast` (falling back to PostgreSQL `readSince` catch-up on any gap or `/snapshot` call), backed by a bounded LRU cache (`MAX_CACHED_BOARDS = 256`).
  3. **Ownership-checked CRDT Undo/Redo (`T60`):** `createUndoManager` checks `map.get(objectId, field)?.hlc === writtenHlc` before reverting so local `Ctrl+Z` never clobbers a peer's newer edit.
  4. **Focus-scoped canvas shortcuts & `happy-dom` tests:** Canvas keyboard shortcuts bind to focusable per-pane containers (preventing split-screen collisions); `apps/web` Vitest uses `happy-dom` instead of `jsdom` (avoiding `jsdom@29`/`undici@8` Node 22 breakage).
  5. **Free student hosting paths (`docs/DEPLOY.md`):** Primary recommendation is GitHub Student Developer Pack (Azure for Students \$100 no-card or DigitalOcean \$200 VM running `2× Spring Boot + Redis + Caddy` + Neon Free + Vercel Hobby + free `.me`/`.tech` domain), with a zero-card Render Free Blueprint (`deploy/render.yaml`, `SYNCCANVAS_BUS=local`, 512 MB JVM flags) and Oracle Always Free as alternatives.
- **Consequences:** All P0–P2 audit flaws are resolved and verified against real Docker Postgres 16 + Redis 7; project is ready for local owner review and student deployment.
