# SyncCanvas — Roadmap

Derived from `IMPLEMENTATION_PLAN.md`. Update when tasks or weekly gates complete.

## Completed (All P0 — Weeks 1–6)
- **Planning:** `PRD.md` v1.1 (+ errata), `IMPLEMENTATION_PLAN.md`, `AGENTS.md`, `.agent/` memory & skills setup.
- **Week 1 (Gate G1):** `T00`–`T08` (Scaffold, Protocol Spec + Schemas, 29 Golden Vectors, TS & Java HLC/LwwMap parity, 10k-op chaos sim, fractional indexing).
- **Week 2 (Gate G2):** `T10`–`T15` (Flyway, `BoardRepository`, per-board gap-free `OpLogRepository`, `OpValidator` + limits, WS handler + `LocalBoardBus`, REST `BoardController`, Postgres Testcontainers ITs).
- **Week 3 (Gate G3):** `T20`–`T27` (Memory/Dexie storage, WS/Loopback transports, `SyncClient`, React `SyncProvider`/`useSyncExternalStore`, Viewport, Shapes/Tools/Bars, RDP Freehand, Text overlay).
- **Week 4 (Gate G4):** `T30`–`T34` (`RedisBoardBus`, `PresenceHandler`, Client Presence + Remote Cursors, Multi-node Compose + Caddy + Dockerfile, 6-client Redis-chaos IT).
- **Week 5 (Gate G5):** `T40`–`T45` (Split-Screen Playground, Chaos Controls + Conflict Demo, CRDT Inspector, Snapshot Compaction, Demo Cleanup + Security Headers + Prometheus metrics, Prod Deploy configs + runbook).
- **Week 6 (Gate G6):** `T50`–`T54` (k6 1,000-VU load test, `/bench` harness, Playwright E2E + CI, portfolio `README.md` + `docs/ARCHITECTURE.md`, `docs/demo-script.md`).

## Remaining Owner Actions (Post-Code)
- Execute `docs/DEPLOY.md` (Neon + VM + Vercel), run k6 + `/bench` against prod and fill in `loadtest/RESULTS.md`, and record the 90s demo video.

## Optional Stretch (P1 — Weeks 7–8)
- `T60` Undo/redo with ownership check, `T61` Latency slider (baseline selector already in Playground), `T62` Multi-select + duplicate, `T63` Diamond/sticky/opacity/alignment UI, `T64` 1,000-object 60 FPS culling pass, `T65` PNG/SVG export.
