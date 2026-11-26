# Current Working State

## Current Feature
- **Week 1 (CRDT & HLC Core — Gate G1) and Week 2 (Single-Node Backend — Gate G2) complete.** Ready to begin **Week 3 (Client Sync Engine + Canvas)**.

## Completed Work
- **Week 1 (`T00`–`T08`):** Monorepo scaffold, wire protocol spec + 7 JSON Schemas + Ajv tests, 29 golden vectors (`hlc.json`, `merge.json` with JCS SHA-256 hashes), fractional indexing (`zindex.ts`), TS HLC + `LwwMap` + 10k-op chaos simulator, Java CRDT port (`com.synccanvas.crdt.*`) + Java vector & `jqwik` tests proving identical TS/Java hash parity.
- **Week 2 (`T10`–`T15`):**
  - `T10` + `T12` (`33a480e`): Flyway `V1__init.sql`, `BoardRepository`, `LimitsProperties`, Jackson wire DTOs (`WsMessage` sealed hierarchy), `OpValidator` (atomic frames, write-once `type`, `CLOCK_SKEW`, `INVALID_FIELD`, `BOARD_FULL` counting tombstones, `rejectedHlcs`), and `TokenBucketRateLimiter`.
  - `T11` (`2e19aa1`): `OpLogRepository` / `JdbcOpLogRepository` (per-board `FOR UPDATE` row lock, intra-batch & DB dedup, gap-free `next_seq` reservation) + `BoardStateService` lazy cache.
  - `T13` + `T14` + `T15` (`6c15077`): `BoardBus` / `LocalBoardBus`, `SessionRegistry` (`ConcurrentWebSocketSessionDecorator`), `BoardWebSocketHandler` (`/ws/boards/{boardId}?clientId=`, 64 KiB guard, `SYNC_PUSH`, chunked `SYNC_PULL`, `SNAPSHOT_REQUIRED`, `PRESENCE`), `BoardController` (`POST /api/v1/boards` with 10/min per-IP limit, `GET /snapshot`, `GET /ops` with `410 Gone`, RFC 7807 `ProblemDetail`), MockMvc tests, and PostgreSQL 16 Testcontainers WebSocket ITs covering all 6 `T15` scenarios.

## Next Task
- **Week 3 — Client Sync Engine + Canvas:**
  - Start with **`T20` · Storage adapters** (`MemoryStorage` + Dexie `IndexedDbStorage` with shared test suite via `fake-indexeddb`) and **`T21` · Transports** (`WebSocketTransport` with backoff/jitter/offline/latency + `LoopbackTransport` + `FakeServer`) in parallel.
  - Then **`T22` · `SyncClient`** (outbox, coalescing, per-op ack by HLC `nodeId`, gap detection, `SNAPSHOT_REQUIRED` merge fallback).

## Blockers
- Docker Desktop is stopped on this machine — Testcontainers ITs (`BoardRepositoryTest`, `OpLogRepositoryTest`, `BackendIntegrationTest`) are skipped locally via `@Testcontainers(disabledWithoutDocker = true)` and run automatically in GitHub Actions CI or once Docker Desktop is started.

## Branch
- `main` (clean working tree, pushed and synced with `origin/main` at `6c15077`). Owner commits directly to `main`.

## Notes
- Last verified: TS (`pnpm format:check && pnpm -r lint && pnpm -r typecheck && pnpm -r test`: 62/62 passed) and Java (`cd server && ./gradlew check --rerun-tasks`: `BUILD SUCCESSFUL`).
- `.agent/` and `AGENTS.md` are git-ignored and local-only.
