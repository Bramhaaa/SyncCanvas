# SyncCanvas — Load & Render Benchmark Results

## How to Reproduce

### 1. Multi-Node WebSocket Load Test (`loadtest/ws-load.js`)

Start the multi-node stack (`2× Spring Boot + Redis + Caddy + Postgres`):

```bash
docker compose --profile multinode up -d --build
```

Run k6 from a separate machine (or locally for smoke testing):

```bash
# Smoke test (50 VUs, 30s)
API_URL=http://localhost:8080 WS_URL=ws://localhost:8080 BOARDS=10 VUS=50 RAMP_UP=10s HOLD=20s RAMP_DOWN=5s \
  k6 run loadtest/ws-load.js

# Full target scenario (100 boards × 10 users = 1,000 VUs, 2m ramp + 5m hold)
API_URL=https://api.<domain> WS_URL=wss://api.<domain> BOARDS=100 VUS=1000 \
  k6 run loadtest/ws-load.js
```

### 2. End-to-End Latency & 1,000-Object Render Benchmark (`/bench`)

Start the frontend (`pnpm --filter web dev`) and open `http://localhost:3000/bench`.

---

## Results Table

> Populate the cells below after running against your deployed VM + Neon Postgres environment.

| Metric                       | Target (PRD §8)         | Measured | Notes                                            |
| ---------------------------- | ----------------------- | -------- | ------------------------------------------------ |
| Concurrent WebSocket VUs     | 1,000 (100 boards × 10) | _TBD_    | `2× Spring Boot 3.5` (Virtual Threads) + Redis 7 |
| Broadcast Latency (p50)      | < 50 ms                 | _TBD_    | Cross-node Redis Pub/Sub fan-out                 |
| Broadcast Latency (p95)      | < 150 ms                | _TBD_    | Same-region Neon + VM                            |
| Broadcast Latency (p99)      | < 300 ms                | _TBD_    | Measured via embedded send timestamp             |
| Sustained Ops/sec            | ≥ 500 ops/s             | _TBD_    | `SYNC_PUSH` + `PRESENCE` @ 10Hz                  |
| Server CPU / RSS (per node)  | < 75% RAM               | _TBD_    | From `docker stats` + `/actuator/metrics`        |
| 1,000-Object Drag Frame Rate | ≥ 95% < 16.7ms          | _TBD_    | From `/bench` rAF harness                        |

## Test Environment

- **Backend VM:** _e.g. Oracle Cloud Ampere A1 (4 vCPU, 24 GB RAM) / Hetzner CAX11_
- **Database:** _Neon PostgreSQL 16 (same region)_
- **Load Generator:** _Separate machine specs + k6 version_
