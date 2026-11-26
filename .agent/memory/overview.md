# SyncCanvas — Overview

## Project Description
SyncCanvas is an offline-first, real-time collaborative digital whiteboard powered by a custom field-level LWW-Map CRDT with Hybrid Logical Clocks (HLC), implemented with identical merge semantics in TypeScript (client) and Java (server).

## Main Goals
- Build a FAANG-grade portfolio project demonstrating distributed systems depth (CRDTs, HLC, per-board gap-free sequencing, multi-node WebSocket fan-out, property-based convergence testing, k6 load benchmarks).
- Ship a zero-login Split-Screen Recruiter Playground (User A + User B side-by-side) with "Kill Network" toggles, scripted conflict demo, and a live CRDT Merge Inspector.
- Keep core CRDT/sync logic hand-written (`@human-owned`) and proven identical across TypeScript and Java via shared RFC 8785 JCS test vectors.

## Major Technologies
- **Frontend:** Next.js 15 (App Router, client-only canvas), React 19, TypeScript (`strict: true`), Tailwind CSS 4, SVG + HTML overlay hybrid canvas, IndexedDB (`Dexie.js` / `idb`).
- **Sync Engine:** Framework-agnostic TypeScript package (`packages/sync-engine`), Vitest, `fast-check`, `canonicalize` (JCS).
- **Backend:** Java 21 (Virtual Threads), Spring Boot 3.x, Gradle (Kotlin DSL), raw `TextWebSocketHandler`, Flyway, PostgreSQL 16, Redis 7 Pub/Sub, JUnit 5, `jqwik`, Testcontainers.
- **Deployment & Testing:** Vercel (frontend), always-on VM with Docker Compose (Caddy + 2× Spring Boot + Redis), Neon (PostgreSQL), Playwright, k6.

## Current Maturity
- Pre-code planning phase. `PRD.md` (v1.1), `IMPLEMENTATION_PLAN.md` (45 tasks across Weeks 1–8), and `AGENTS.md` are finalized. Monorepo scaffold (`T00`) has not been run yet.
