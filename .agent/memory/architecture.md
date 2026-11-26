# SyncCanvas — Architecture

## Architecture Summary
Monorepo with a framework-agnostic TypeScript sync engine, a Next.js client-only canvas/playground app, a horizontally scalable Java 21 / Spring Boot WebSocket backend, and a shared language-neutral protocol/vector specification. The server is a durable replica + relay (orders ops with per-board `serverSeq`, persists, fans out) — it does **not** arbitrate conflicts.

## Planned Repository Structure
- `apps/web/` — Next.js 15 App Router UI (infinite SVG/HTML canvas, Split-Screen Playground, CRDT Inspector).
- `packages/sync-engine/` — Pure TS CRDT (`HlcClock`, `LwwMap`), IndexedDB storage adapter, WebSocket/Loopback transport, `SyncClient` (outbox, coalescing, ack, gap detection, snapshot fallback).
- `server/` — Spring Boot 3 / Java 21 backend (`com.synccanvas.{crdt,protocol,ws,persistence,pubsub,api,config,jobs}`).
- `spec/` — Single source of truth: `protocol.md`, JSON schemas, and cross-language golden test vectors (`spec/vectors/*.json`).
- `loadtest/` — k6 WebSocket load test scripts and benchmark results.
- `deploy/` & `docker-compose.yml` — Local and production multi-node setup (Caddy + 2× Spring Boot + Redis + Postgres).

## Data Flow
1. **Local optimistic write:** UI calls `SyncClient.mutate()` → stamps HLC → merges into local `LwwMap` (0ms UI latency) → persists registers + coalesced outbox to IndexedDB.
2. **Push & sequence:** Throttled flush (30–50ms) sends `SYNC_PUSH` over WebSocket → Spring Boot validates (field whitelist, skew guard, size/rate limits), deduplicates, reserves gap-free per-board `serverSeq` via `UPDATE boards SET next_seq = next_seq + :n`, appends to `crdt_operations`, updates in-memory `LwwMap`.
3. **Fan-out & ack:** Spring Boot publishes `SYNC_BROADCAST` (`serverSeqStart..serverSeqEnd`) to Redis `board:ops:{boardId}` → all nodes push to **all** local clients including origin → origin clears acked ops from outbox; peers merge deterministically.
4. **Recovery:** Client tracks highest contiguous `lastSyncedSeq`; gaps trigger `SYNC_PULL`; clients behind pruned ops receive `SNAPSHOT_REQUIRED` and **merge** (never replace) the compacted snapshot before flushing outbox.
5. **Presence:** Ephemeral cursors/selections (`PRESENCE`) flow through `board:presence:{boardId}` only, never persisted.

## Core Invariants
- Never use Yjs, Automerge, or any third-party CRDT library.
- State hash = lowercase hex SHA-256 of RFC 8785 (JCS) canonical JSON of sorted `[objectId, field, value, hlc]` tuples — must match identically in TS and Java.
- Deletions are delete-wins tombstones (`deleted = true`), no tombstone GC in v1.
- Render z-order sorts by `(zIndex, objectId)` using fractional indexing.
