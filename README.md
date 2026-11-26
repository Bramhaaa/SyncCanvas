# SyncCanvas

Offline-first, real-time collaborative digital whiteboard powered by a custom field-level LWW-Map CRDT and Hybrid Logical Clocks (HLC), implemented with identical merge semantics in TypeScript and Java.

## Workspace Layout

- `apps/web` — Next.js 15 App Router frontend (infinite SVG/HTML canvas, Split-Screen Playground, CRDT Inspector)
- `packages/sync-engine` — Framework-agnostic TypeScript CRDT & sync engine
- `server` — Java 21 / Spring Boot 3 WebSocket backend
- `spec` — Wire protocol specification and cross-language golden test vectors (added in T01–T02)

## Local Development

```bash
# Start Postgres 16 + Redis 7
docker compose up -d postgres redis

# Install JS/TS dependencies
pnpm install

# Run TS checks
pnpm -r lint && pnpm -r typecheck && pnpm -r test

# Run Java checks
cd server && ./gradlew check

# Run the Next.js dev server
pnpm --filter web dev
```
