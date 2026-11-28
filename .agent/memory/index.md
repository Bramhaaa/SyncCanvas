# SyncCanvas — Semantic Index

Consult this file before searching the repository. Updated only when project structure changes.

## Product Specification, Plan & Docs
- **Files:** `PRD.md` (v1.1 + errata), `IMPLEMENTATION_PLAN.md` (T00–T65, §2 Shared Contracts), `README.md`, `docs/ARCHITECTURE.md`, `docs/DEPLOY.md` (free student deployment paths), `docs/demo-script.md`.

## Protocol & Golden Vectors (`spec/`)
- **Purpose:** Single source of truth for wire format, field whitelist, validation rules, and cross-language test vectors.
- **Files:** `spec/protocol.md`, `spec/schema/*.schema.json` (7 Draft 2020-12 schemas), `spec/vectors/hlc.json` (14 cases), `spec/vectors/merge.json` (15 cases with JCS SHA-256 `expectHash`).

## TS Sync Engine (`packages/sync-engine/`)
- **Purpose:** Framework-agnostic TypeScript CRDT, storage, transport, presence, undo/redo, and sync client.
- **Source:** `src/{types,protocol,hlc,lww-map,hash,zindex,emitter,sync-client,presence,undo,index}.ts`, `src/storage/{memory,indexeddb,index}.ts`, `src/transport/{websocket,loopback,index}.ts`.
- **Tests (90 tests):** `test/{schema,hlc,lww-map,zindex,storage,transport,sync-client,presence,undo}.test.ts`, `test/sim/{simulator.ts,convergence.test.ts}`.

## Spring Boot Backend (`server/`)
- **Purpose:** Java 21 / Spring Boot 3.5.16 / Gradle 8.14.2 horizontally scalable WebSocket & persistence backend.
- **Config & Migrations:** `build.gradle.kts` (`app.jar`), `Dockerfile` (512 MB low-mem JVM flags), `application.yml`, `db/migration/V1__init.sql`, `config/{LimitsProperties,WebSocketConfig,SecurityHeadersFilter,SyncCanvasMetrics}.java`.
- **CRDT Core (`com.synccanvas.crdt`):** `Hlc`, `HlcClock`, `ClockSkewException`, `Op`, `Register`, `MergeResult` (`Accepted`/`DiscardedStale`), `LwwMap`.
- **Protocol & Validation (`com.synccanvas.protocol`):** `WsMessage` sealed DTOs, `ProtocolErrorCode`, `OpValidator`, `ValidationResult`, `TokenBucketRateLimiter`.
- **Persistence & Jobs (`persistence`, `jobs`):** `Board`, `BoardRepository`, `SequencedOp`, `OpLogRepository`, `JdbcOpLogRepository`, `SnapshotRepository`, `BoardStateService` (bounded LRU + multi-node remote broadcast sync + 500-op compaction trigger), `CompactionJob`, `DemoCleanupJob`.
- **WebSocket, Pub/Sub & REST (`ws`, `pubsub`, `api`):** `BoardBus`, `BoardListener`, `LocalBoardBus`, `RedisBoardBus`, `BusConfig`, `SessionRegistry`, `PresenceHandler`, `BoardWebSocketHandler`, `BoardController`, `ApiExceptionHandler`.
- **Tests:** Unit, vector, `jqwik` property tests, MockMvc tests, and Docker Testcontainers ITs (`BoardRepositoryTest`, `OpLogRepositoryTest`, `RedisBoardBusTest`, `BackendIntegrationTest`, `CompactionIntegrationTest`).

## Next.js Frontend (`apps/web/`)
- **Purpose:** Next.js 15 App Router + React 19 + Tailwind CSS 4 client-only canvas, Split-Screen Playground, CRDT Inspector, and `/bench`.
- **Routes:** `src/app/page.tsx` (`/` Playground), `src/app/b/[boardId]/page.tsx` (shareable single board), `src/app/bench/page.tsx` (perf harness).
- **Modules:** `src/sync/{SyncProvider,sync-store,index}`, `src/canvas/{Viewport,viewport-math,useViewport,WhiteboardCanvas}`, `src/canvas/{shapes,selection,tools,freehand,text,presence,export}`, `src/components/{Toolbar,PropertyBar}`, `src/inspector/CrdtInspector.tsx`, `src/playground/{PlaygroundView,SingleBoardView,chaos/*}`, `src/bench/BenchView.tsx`.
- **Tests (15 tests, happy-dom):** `test/{sync-binding,viewport-math,freehand,canvas-tools,conflict-demo,scaffold}.test.{ts,tsx}`.

## E2E, Load Testing, Deploy & CI
- **Files:** `docker-compose.yml` (`multinode` profile), `deploy/{Caddyfile,Caddyfile.prod,docker-compose.prod.yml,render.yaml}`, `e2e/multinode/chaos.mjs`, `e2e/web/{playwright.config.ts,playground.spec.ts}`, `loadtest/{ws-load.js,RESULTS.md}`, `.github/workflows/{ci,deploy,e2e,multinode-chaos}.yml`.
- **Tracked Memory & Rules:** `.agent/` (memory, skills, templates, `AGENT.md`), `AGENTS.md`.
