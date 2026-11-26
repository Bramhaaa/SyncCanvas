# SyncCanvas — Roadmap

Derived from `IMPLEMENTATION_PLAN.md`. Update when tasks or weekly gates complete.

## Completed
- **Planning:** `PRD.md` v1.1 (+ errata), `IMPLEMENTATION_PLAN.md`, `AGENTS.md`, `.agent/` memory & skills setup.
- **Week 1 (CRDT & HLC Core — Gate G1):** `T00` Scaffold, `T01` Protocol spec + JSON Schemas + Ajv tests, `T02` 29 Golden vectors, `T03` TS HLC, `T04` TS `LwwMap` + JCS `stateHash`, `T05` TS 10k-op chaos simulator, `T06` Java CRDT port, `T07` Java vector + `jqwik` tests (exact TS/Java hash parity), `T08` Fractional indexing.
- **Week 2 (Single-Node Backend — Gate G2):** `T10` Flyway `V1__init.sql` + `BoardRepository`, `T11` Per-board gap-free `OpLogRepository` + `BoardStateService`, `T12` Protocol DTOs + `OpValidator` + `LimitsProperties` + `TokenBucketRateLimiter`, `T13` `BoardWebSocketHandler` + `SessionRegistry` + `LocalBoardBus`, `T14` REST `BoardController` + RFC 7807 `ProblemDetail`, `T15` Backend WebSocket ITs.

## In Progress
- None (ready to start Week 3: `T20` + `T21`).

## Planned (P0 — Weeks 3–6)
- **Week 3 (Client Sync Engine + Canvas):** {T20 Storage, T21 Transport} → T22 SyncClient → T23 React binding → {T24 Viewport, T25 Shapes/tools, T26 Freehand, T27 Text} → **Gate G3**.
- **Week 4 (Multi-Node + Presence):** T30 Redis BoardBus → {T31 Server presence, T32 Client presence, T33 Multi-node Compose + Caddy} → T34 Multi-node chaos IT → **Gate G4**.
- **Week 5 (Playground, Inspector, Deploy):** {T40 Split-screen playground, T42 CRDT Inspector, T43 Compaction, T44 Demo hygiene} → T41 Chaos controls + Conflict Demo → T45 Prod deploy → **Gate G5**.
- **Week 6 (Benchmarks & Story):** {T50 k6 load test, T51 E2E latency + render bench, T52 Playwright E2E, T53 README + Architecture docs} → T54 Demo video + résumé bullets → **Gate G6**.

## Planned (P1 — Weeks 7–8, Stretch)
- T60 Undo/redo with ownership check, T61 Latency slider, T62 Multi-select + duplicate, T63 Diamond/sticky/opacity/alignment, T64 1,000-object 60 FPS perf pass, T65 PNG/SVG export.
