# SyncCanvas — Semantic Index

Consult this file before searching the repository. Updated only when project structure changes.

## Product Specification & Plan
- **Purpose:** Full requirements, CRDT/HLC algorithm spec, wire protocol, DB schema, NFRs, and week-by-week delegation plan.
- **Files:** `PRD.md` (v1.1 + 2026-11-26 errata), `IMPLEMENTATION_PLAN.md` (T00–T65, §2 Shared Contracts).

## Protocol & Golden Vectors (`spec/`)
- **Purpose:** Single source of truth for wire format, field whitelist, validation rules, and cross-language test vectors.
- **Files:** `spec/protocol.md`, `spec/schema/*.schema.json` (7 Draft 2020-12 schemas), `spec/vectors/hlc.json` (14 cases), `spec/vectors/merge.json` (15 cases with verified JCS SHA-256 `expectHash`).

## TS Sync Engine (`packages/sync-engine/`)
- **Purpose:** Framework-agnostic TypeScript CRDT & sync engine.
- **Source:** `src/types.ts`, `src/protocol.ts`, `src/hlc.ts`, `src/lww-map.ts`, `src/hash.ts`, `src/zindex.ts`, `src/index.ts`.
- **Tests:** `test/schema.test.ts` (Ajv), `test/hlc.test.ts`, `test/lww-map.test.ts`, `test/zindex.test.ts`, `test/sim/simulator.ts`, `test/sim/convergence.test.ts`.
- **Planned (Week 3):** `src/storage/**` (T20), `src/transport/**` (T21), `src/sync-client.ts` (T22).

## Spring Boot Backend (`server/`)
- **Purpose:** Java 21 bytecode / Spring Boot 3.5.16 / Gradle 8.14.2 WebSocket & persistence backend.
- **Config & Migrations:** `server/build.gradle.kts`, `application.yml`, `db/migration/V1__init.sql`, `config/LimitsProperties.java`, `config/WebSocketConfig.java`.
- **CRDT Core (`com.synccanvas.crdt`):** `Hlc`, `HlcClock`, `ClockSkewException`, `Op`, `Register`, `MergeResult` (`Accepted`/`DiscardedStale`), `LwwMap`.
- **Protocol & Validation (`com.synccanvas.protocol`):** `WsMessage` sealed DTOs (`SyncPush`, `SyncPull`, `SyncBroadcast`, `SnapshotRequired`, `Error`, `Presence`), `ProtocolErrorCode`, `OpValidator`, `ValidationResult`, `TokenBucketRateLimiter`.
- **Persistence (`com.synccanvas.persistence`):** `Board`, `BoardRepository`, `SequencedOp`, `OpLogRepository`, `JdbcOpLogRepository`, `BoardStateService`.
- **WebSocket, Pub/Sub & REST (`ws`, `pubsub`, `api`):** `BoardBus`, `BoardListener`, `LocalBoardBus`, `SessionRegistry`, `BoardWebSocketHandler`, `BoardController`, `ApiExceptionHandler`, response DTOs.
- **Tests:** `HealthEndpointTest`, `crdt/*Test` (vectors + `jqwik`), `protocol/*Test`, `persistence/BoardRepositoryTest`, `persistence/BoardStateServiceTest`, `persistence/OpLogRepositoryTest`, `api/BoardControllerTest`, `it/BackendIntegrationTest`.
- **Planned (Weeks 4–5):** `pubsub/RedisBoardBus.java` (T30), `ws/PresenceHandler.java` (T31), `jobs/**` compaction & cleanup (T43–T44).

## Next.js Frontend (`apps/web/`)
- **Purpose:** Next.js 15 App Router + React 19 + Tailwind CSS 4 client-only canvas & Split-Screen Playground.
- **Current:** Skeleton (`src/app/layout.tsx`, `src/app/page.tsx`, `next.config.ts`).
- **Planned (Weeks 3–5):** `src/sync/**` (T23), `src/canvas/**` (T24–T27), Playground & CRDT Inspector (T40–T42).

## Infra, CI & Local Memory
- **Files:** `docker-compose.yml` (Postgres 16 + Redis 7), `.github/workflows/ci.yml`, `pnpm-workspace.yaml`, `tsconfig.base.json`.
- **Local-only (git-ignored):** `.agent/` (memory, skills, templates, `AGENT.md`), `AGENTS.md`.
