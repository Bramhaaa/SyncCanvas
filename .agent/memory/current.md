# Current Working State

## Current Feature
- **All P0 Weeks 1–6 (`T00`–`T54`) complete.** SyncCanvas is feature-complete for P0 (CRDT core, single- and multi-node Spring Boot backend, offline-first sync engine, infinite canvas, Split-Screen Recruiter Playground, Conflict Demo, CRDT Inspector, compaction/cleanup jobs, prod deploy configs, k6 load test, `/bench` harness, Playwright E2E, README + Architecture docs, demo script).

## Completed Work
- **Week 1 (`T00`–`T08`):** Scaffold, wire protocol spec + 7 JSON Schemas, 29 golden vectors (`hlc.json`, `merge.json` with JCS SHA-256), fractional indexing, TS + Java CRDT/HLC parity, 10k-op convergence property tests.
- **Week 2 (`T10`–`T15`):** Flyway `V1__init.sql`, `BoardRepository`, per-board gap-free `JdbcOpLogRepository` (`FOR UPDATE`), `BoardStateService`, wire DTOs + `OpValidator` + rate limiter, `LocalBoardBus` + `SessionRegistry` + `BoardWebSocketHandler`, REST `BoardController`, and Postgres Testcontainers ITs.
- **Week 3 (`T20`–`T27`):** `MemoryStorage` + Dexie `IndexedDbStorage`, `WebSocketTransport` + `LoopbackTransport`/`FakeServer`, `SyncClient` (outbox coalescing, per-op ack, gap detection, `SNAPSHOT_REQUIRED` merge), React `SyncProvider`/`useObject`/`useVisibleIds`/`useSyncEvents`, infinite `Viewport`, shapes/selection/resize/toolbar/property bar, RDP freehand, and overlay text editor.
- **Week 4 (`T30`–`T34`):** `RedisBoardBus` + `BusConfig` + Redis Testcontainers IT, server `PresenceHandler`, client `PresenceClient` + remote cursors/selections, multi-node Docker Compose + Caddy + `server/Dockerfile`, and 6-client Redis-chaos convergence IT (`e2e/multinode/chaos.mjs`).
- **Week 5 (`T40`–`T45`):** Split-Screen Playground (`/` + `/b/[boardId]` with Local Simulation fallback), Chaos Controls + 6-step Conflict Demo, CRDT Merge Inspector drawer, `SnapshotRepository` + `CompactionJob`, `DemoCleanupJob` + `SecurityHeadersFilter` + Micrometer/Prometheus metrics, and production deploy configs (`deploy/`, `.github/workflows/deploy.yml`, `docs/DEPLOY.md`).
- **Week 6 (`T50`–`T54`):** k6 1,000-VU WebSocket load test (`loadtest/ws-load.js`, `RESULTS.md`), `/bench` latency + 1,000-object render harness, Playwright E2E suite (`e2e/web/` + `.github/workflows/e2e.yml`), portfolio `README.md` + `docs/ARCHITECTURE.md`, and `docs/demo-script.md`.

## Next Task
- **Live deployment & benchmark execution** (owner-executed per `docs/DEPLOY.md`: provision Neon + VM + Vercel, run k6 & `/bench` and record real numbers in `loadtest/RESULTS.md` + `README.md`, record 90s demo video).
- **Optional P1 stretch (`T60`–`T65`):** ownership-checked undo/redo, multi-select + duplicate, sticky/diamond toolbar tools, 1,000-object 60 FPS culling pass, PNG/SVG export.

## Blockers
- None.

## Branch
- `main` (synced with `origin/main`).
