# Product Requirements Document (PRD): SyncCanvas — Offline-First Real-Time Collaborative Whiteboard

**Version:** 1.1 (see [Changelog](#10-changelog-v10--v11))

**Target Timeline:** 6 weeks for P0 (core, demo-ready) + 2 weeks for P1 (polish/stretch), built part-time alongside an internship

**Primary Tech Stack:** TypeScript, Next.js (App Router), IndexedDB, Java 21, Spring Boot 3 (WebSockets), Redis Pub/Sub, PostgreSQL

**Deployment Target:** Vercel (Frontend) + one always-on VM running Docker Compose (Caddy/Nginx + 2× Spring Boot + Redis) on Oracle Cloud Free Tier / Hetzner / AWS EC2 + Neon (PostgreSQL, same region as the VM)

> **Priority legend:** **[P0]** = must ship for the demo/resume. **[P1]** = ship if time allows. Anything untagged is P0.

---

## 1. Executive Summary & Product Vision

### 1.1 Problem Statement

Collaborative design tools (like Figma or Miro) need edits to show up for other users almost instantly, and they need to keep working when the network is bad. Figma and Miro handle this with a server that has the final say, which means real offline editing is hard: when a device reconnects after a long time offline, the system needs a principled way to merge that device's edits without losing them or freezing the UI.

### 1.2 Solution

**SyncCanvas** is an offline-first, multiplayer digital whiteboard built around a **custom-engineered Conflict-free Replicated Data Type (CRDT)** and **Hybrid Logical Clocks (HLC)**. Users can pan/zoom an infinite canvas, create and style geometric shapes, draw freehand annotations, add text, and see live collaborator cursors. Every mutation is applied optimistically to the local browser database (**IndexedDB**) and synced asynchronously via a horizontally scalable **Java 21 + Spring Boot WebSocket** backend backed by **Redis Pub/Sub** and **PostgreSQL**.

Unlike server-authoritative designs, the server here **does not decide conflicts**. It is a durable replica plus relay: it orders operations for catch-up (`serverSeq`), stores them, and fans them out. Any two replicas that have seen the same set of operations reach the same state, whether or not the server is involved.

To make it easy for technical recruiters and interviewers to try, SyncCanvas ships with a no-login **Split-Screen Playground**. It shows two independent clients (User A and User B) side by side, a **"Kill Network"** toggle for each one, and a live **CRDT Merge Inspector** that shows each conflict being resolved in real time.

### 1.3 Goals vs. Non-Goals

| Goals (In Scope) | Non-Goals (Out of Scope) |
| --- | --- |
| Custom LWW-Map CRDT with Hybrid Logical Clocks implemented with identical merge semantics in TypeScript (client) and Java (server), proven by shared cross-language test vectors. | Using third-party CRDT libraries (`Yjs`, `Automerge`) for core state synchronization. |
| Infinite canvas supporting shapes (rectangles, ellipses, arrows), freehand drawing, text boxes, styling, and z-index layering. | Advanced vector boolean operations, Figma auto-layout, or plugin ecosystems. |
| True offline-first persistence via IndexedDB with automatic delta reconciliation upon reconnect. | Full character-by-character rich-text CRDT (e.g., RGA/Fugue) inside text boxes (v1 uses field-level LWW for text content; concurrent edits to the *same* text box keep the later write). |
| Horizontally scalable Spring Boot WebSocket cluster synchronized via Redis Pub/Sub. | Enterprise SSO, billing, or folder/team permission hierarchies. |
| Automated property-based convergence tests and load-test benchmarks for resume metrics. | Mobile native apps (web desktop/tablet responsive only). |
| | Tombstone garbage collection (requires knowing every replica's state; out of scope for v1). |

---

## 2. System Architecture & Tech Stack

### 2.1 High-Level Data Flow

1. **Local Optimistic Mutation:** User A drags a rectangle or draws a freehand stroke. The frontend generates a new **HLC timestamp** and updates the in-memory CRDT state right away, so the UI responds within the same frame. It then writes the delta to **IndexedDB** and adds it to the **outbox** (outbound sync buffer).
2. **Real-Time Broadcast:** If online, the client sends the compact JSON delta over a persistent **WebSocket** connection to a **Spring Boot** node.
3. **Server Validation, Persistence & Fan-Out:**
   * The Spring Boot node validates the payload (schema, field whitelist, size, clock-skew guard — see §3.1). In a single transaction it reserves a contiguous range of **per-board** sequence numbers, merges the delta into the board's canonical state, and appends the operations to **PostgreSQL**.
   * After commit, it publishes the delta (with its `serverSeq`) to the Redis Pub/Sub channel `board:ops:{boardId}`.
   * Every Spring Boot instance subscribed to `board:ops:{boardId}` pushes the message to **all** of its locally connected clients for that board, **including the origin client**. For the origin, the broadcast doubles as the **acknowledgement**: it removes the acked ops from its outbox and advances `lastSyncedSeq`. Re-merging its own ops does nothing because merge is idempotent.
4. **Remote Merge:** User B's browser receives the delta, runs the deterministic `merge()` function against its local CRDT state, persists to IndexedDB, and re-renders only the affected canvas elements.
5. **Gap Detection:** Each client tracks the highest *contiguous* `serverSeq` it has received. If a broadcast arrives with `serverSeq > lastSyncedSeq + 1`, the client buffers it and sends `SYNC_PULL` to fill the gap. A gap can appear because Redis Pub/Sub is fire-and-forget and because publishes from different nodes can interleave.
6. **Offline Reconciliation:** If User A goes offline, edits pile up in IndexedDB. When User A reconnects, the client sends `SYNC_PULL` with its `lastSyncedSeq`, receives the deltas it missed, and then flushes its outbox. Both clients end up with exactly the same state.

### 2.2 Technology Stack

| Layer | Technology | Rationale |
| --- | --- | --- |
| **Frontend Framework** | Next.js 15 (App Router), React, TypeScript, Tailwind CSS | Fast UI development; zero-config deployment on Vercel. The canvas and sync engine are **client-only** (`"use client"` + `dynamic(..., { ssr: false })`) because IndexedDB/WebSocket do not exist during SSR. |
| **Client State** | Framework-agnostic `sync-engine` TS package + a thin React binding (e.g., `useSyncExternalStore` / Zustand) with per-object subscriptions | Keeps the CRDT/sync logic testable without React and avoids re-rendering 1,000 objects when one changes. |
| **Canvas Engine** | **SVG + HTML Overlay Hybrid** (custom viewport transform) | SVG keeps shapes and freehand `<path>` strokes crisp at any zoom level. A plain HTML `<textarea>` handles text editing, which avoids the pain of rendering editable text on an HTML5 Canvas. |
| **Offline Storage** | IndexedDB (via `Dexie.js` or `idb`) | Asynchronous, high-capacity browser storage that survives page reloads and offline sessions. |
| **Backend Core** | Java 21 (Virtual Threads), Spring Boot 3.3+, Spring WebSocket (raw `TextWebSocketHandler`, no STOMP) | Handles many concurrent WebSocket connections and matches common enterprise Java backend stacks. Raw handlers keep the protocol explicit and easy to load-test. |
| **Pub/Sub & Scaling** | Redis (Pub/Sub for fan-out; key TTLs for presence) | Decouples WebSocket connections across multiple Spring Boot instances. Because Pub/Sub delivery is best-effort, correctness comes from `serverSeq` gap detection and is not delegated to Redis. |
| **Primary Database** | PostgreSQL 16 (Neon, same region as backend VM) | Stores board metadata, append-only CRDT operation logs, and periodic compacted snapshots. |
| **Load & Chaos Testing** | k6 (WebSocket load testing) + JUnit 5 / jqwik + fast-check (property-based CRDT tests) | Produces concurrency and convergence benchmarks that others can verify. |

### 2.3 Repository Layout (Monorepo)

```
synccanvas/
├── apps/web/                 # Next.js app (canvas UI, playground, inspector)
├── packages/sync-engine/     # TS: HLC, LWW-Map, outbox, transport interface (no React)
├── server/                   # Spring Boot (Gradle), Java 21
├── spec/
│   ├── protocol.md           # Wire format (single source of truth for §5)
│   └── vectors/*.json        # Cross-language golden test vectors (HLC + merge)
├── loadtest/                 # k6 scripts + results
└── docker-compose.yml        # 2× server + Redis + Postgres + Caddy (local multi-node)
```

---

## 3. Custom CRDT & HLC Specification (Core Algorithm)

To guarantee **Strong Eventual Consistency (SEC)** without a server deciding conflicts, the TypeScript client and the Java server must implement exactly the same deterministic specification. Parity is enforced by running both implementations against the same JSON test vectors in `spec/vectors/`.

### 3.1 Hybrid Logical Clock (HLC)

Physical wall clocks (`Date.now()`) drift from device to device. An HLC combines physical time, a logical counter, and a unique node ID to put all distributed edits into a **strict total order**. The order also respects causality: if edit B happened after its author saw edit A, then B sorts after A.

* **Format:** `{ physicalTime: long (ms), counter: int, nodeId: string }`
* **String Serialization (for lexicographical sorting):** `{13-digit-zero-padded-ms}:{5-digit-zero-padded-counter}:{nodeId}` (e.g., `1732579200000:00001:client_a7f2`). `nodeId` must match `[a-z0-9_]{1,32}` and must not contain `:`.
* **Node ID:** A random ID is generated per client replica (per browser + per playground pane) and persisted in IndexedDB `meta`. It must be globally unique.
* **Local Tick Rule (on local edit):**
  1. `now = currentPhysicalTimeMs()`
  2. If `now > last.physicalTime`: `physicalTime = now`, `counter = 0`.
  3. Else: `physicalTime = last.physicalTime`, `counter = last.counter + 1`.
* **Receive Rule (on remote op with `r`)**, following Kulkarni et al. (2014):
  1. `now = currentPhysicalTimeMs()`
  2. `pt = max(now, last.physicalTime, r.physicalTime)`
  3. Counter:
     * if `pt == last.physicalTime == r.physicalTime` → `counter = max(last.counter, r.counter) + 1`
     * else if `pt == last.physicalTime` → `counter = last.counter + 1`
     * else if `pt == r.physicalTime` → `counter = r.counter + 1`
     * else (`now` strictly greatest) → `counter = 0`
* **Counter Overflow:** If `counter` would exceed `99999`, set `physicalTime = physicalTime + 1`, `counter = 0`.
* **Clock-Skew Guard:** The server rejects any op whose `hlc.physicalTime > serverNow + MAX_DRIFT_MS` (default `60_000`) and replies with `ERROR { code: "CLOCK_SKEW" }`. Only the server enforces this guard: clients always merge ops delivered in a `SYNC_BROADCAST` (the server already validated them), and if their own clock is behind they simply do not advance it (see `spec/protocol.md` §2.6). If clients dropped ops based on their local clocks, replicas with different clocks would diverge. Without this guard, one client with a badly wrong clock could "win" every future conflict.
* **Comparison (`compareHlc(a, b)`):** Compare `physicalTime` first, then `counter`, then `nodeId` lexicographically. As long as `nodeId`s are unique and each node issues strictly increasing timestamps, two distinct operations can never tie.

### 3.2 Granular LWW-Map (Field-Level Merging)

Instead of storing an entire shape as one Last-Write-Wins blob, every canvas object is represented as a **Map of LWW-Registers** keyed by `(objectId, propertyName)`.

* **Why this matters:** Say User A moves Rectangle 1 (`x`, `y`) while offline, and User B changes its color (`fill`) while offline. These edits touch *different registers*, so the merge keeps **both** the new position and the new color.
* **Register Structure:**

```json
{
  "objectId": "obj_91f2a",
  "field": "fill",
  "value": "#3B82F6",
  "hlc": "1732579200120:00000:user_b"
}
```

* **Object Existence:** An object exists once it has a `type` register. Creation writes all initial registers (`type`, `x`, `y`, `w`, `h`, `zIndex`, style fields) in one batch.
* **Field Whitelist & Types:** Allowed fields per object type are defined in `spec/protocol.md`. The server rejects unknown fields or wrongly typed values.
* **Merge Rule:** For a given `(objectId, field)`, keep the register with the strictly greater `hlc`. This operation is **commutative** ($A \cup B = B \cup A$), **associative** ($(A \cup B) \cup C = A \cup (B \cup C)$), and **idempotent** ($A \cup A = A$).

### 3.3 Deletions (Tombstones) & Layering (Fractional Indexing)

* **Tombstones (delete-wins for visibility):** Deleting an object sets a special register `(objectId, "deleted") = true` with an HLC timestamp. An object is rendered only if its `deleted` register is absent or `false`. A concurrent or later edit to some *other* field (e.g., `x`) therefore **cannot** bring a deleted object back. Only an explicit `deleted = false` with a greater HLC can, which is what undo-delete does.
* **Tombstone retention:** In v1, tombstones are kept for the board's lifetime. They are never garbage-collected, because safe GC would require knowing that every replica (including offline ones) has seen the delete.
* **Z-Index Ordering:** Use **Fractional Indexing** (lexicographic strings like `"a0"`, `"a1"`, `"a0V"`) stored in the `zIndex` register. Bringing an object forward or backward then never requires renumbering every other object on the canvas. Two clients may generate the same key at the same time, so render order is sorted by **`(zIndex, objectId)`** to keep it deterministic.

---

## 4. Functional Requirements

### 4.1 Infinite Canvas & Creation Tools

* **FR-1.1 Viewport Navigation [P0]:** Smooth pan (Space + drag or middle-click) and zoom (mouse wheel / pinch, 10% to 400%) using CSS/SVG transform matrices.
* **FR-1.2 Supported Element Types:**
  * **Shapes [P0]:** Rectangle, Ellipse, Line/Arrow. **[P1]:** Diamond.
  * **Freehand Drawing [P0]:** Smooth SVG `<path>` strokes captured via pointer events. Points are simplified with Ramer-Douglas-Peucker and smoothed with quadratic Béziers, then stored as a point array in the `points` register. A stroke is sent once, on pointer-up, and is capped by the frame limit (§7.3).
  * **Text [P0]:** Editable text blocks with font size. **[P1]:** Sticky notes (background color), alignment.
* **FR-1.3 Manipulation & Styling:** **[P0]** Select, drag-to-move, corner-handle resize, delete, and a floating property bar (fill color, stroke color, stroke width, bring-to-front / send-to-back). **[P1]** Multi-select, duplicate, 8-handle resize, opacity.
* **FR-1.4 Local Undo / Redo [P1]:** Per-user undo stack that generates *new* compensating CRDT operations with fresh HLC timestamps. Each undo entry records `(objectId, field, previousValue, hlcIWrote)`. On undo, the compensating op is issued **only if the register's current HLC is still `hlcIWrote`**. If another user has changed that field since, the undo skips it, so User A undoing their own move never reverts User B's edits.

### 4.2 Offline-First Persistence & Sync Engine

* **FR-2.1 Local-First Storage:** All CRDT registers and the `outbox` queue are persisted in **IndexedDB**. Reloading the browser while offline restores the exact canvas state. An op is removed from the outbox only after the client receives its own op back in a `SYNC_BROADCAST`, which serves as the ack.
* **FR-2.2 Delta Batching & Coalescing:** During rapid actions (like dragging a shape), outbound WebSocket flushes are throttled to every **30–50ms** while local rendering stays at 60 FPS. Within a flush window, ops are **coalesced per register**: only the latest value for each `(objectId, field)` is sent. While offline, the outbox is coalesced the same way, so a 10-second offline drag becomes 2 ops, not 600.
* **FR-2.3 Automatic Reconnection & Backfill:** WebSocket reconnection uses exponential backoff with jitter. On reconnect, the client sends `SYNC_PULL { lastSyncedSeq }`, applies the missed ops the server returns, and then flushes its outbox.
* **FR-2.4 Snapshot Fallback:** If `lastSyncedSeq` is older than the oldest op still kept in the log (pruned by compaction, §6.2), the server replies `SNAPSHOT_REQUIRED`. The client fetches the snapshot and **merges** it into local state; it never replaces local state. Unsynced local edits therefore survive, and the client then flushes its outbox.
* **FR-2.5 Gap Detection:** See §2.1 step 5. Out-of-order broadcasts are buffered until the gap is filled.

### 4.3 Real-Time Presence (Ephemeral State)

* **FR-3.1 Live Cursors & Selections [P0]:** Broadcast cursor `(x, y)` coordinates and `selectedObjectIds` over WebSockets at ~20Hz.
* **FR-3.2 Ephemeral Handling:** Presence messages bypass PostgreSQL and CRDT storage completely. They are fanned out purely through memory and Redis Pub/Sub (`board:presence:{boardId}`), and clients hide a remote cursor after 5 seconds without an update.

### 4.4 Recruiter Split-Screen Playground & CRDT Inspector

* **FR-4.1 Zero-Setup Entry [P0]:** Landing on `/` creates a **fresh ephemeral demo board per visitor**, so concurrent visitors never collide, and loads a **Split-Screen Demo** with two isolated client instances: **User A** on the left and **User B** on the right. Each pane has its own `nodeId`, its own IndexedDB database (`synccanvas_{boardId}_{paneId}`), and its own WebSocket connection. A toggle switches to **Full-Screen Mode** or copies a shareable room URL. If the backend is unreachable, the page still works in local-only mode and shows a clear banner.
* **FR-4.2 Chaos Controls:**
  * **[P0]** Independent **"Online / Kill Network"** toggle for User A and User B. It is implemented with a `Transport` interface in `sync-engine` (`connect`, `send`, `onMessage`, `setOnline`, `setLatency`). "Kill" closes the socket and queues sends; the browser's network is not actually touched.
  * **[P1]** Simulated **Network Latency Slider** (`0ms`, `250ms`, `1000ms`), applied symmetrically in the transport, to show how responsive the optimistic UI stays.
  * **[P0]** **"Run Conflict Demo" button:** one click runs a scripted sequence that disconnects User A, moves a shape on A, recolors it on B, reconnects A, and highlights the clean merge.
* **FR-4.3 Live CRDT Inspector Drawer [P0]:** A collapsible bottom/side panel displaying:
  * Incoming/outgoing deltas with their raw HLC timestamps.
  * Merge outcomes (`ACCEPTED` vs. `DISCARDED_STALE` with reason, e.g., "remote hlc < local hlc").
  * Queue depth (number of un-synced offline operations) and `lastSyncedSeq`.

---

## 5. API & WebSocket Protocol Specification

> `spec/protocol.md` is the single source of truth. Both TS and Java types are written against it (optionally generated from a JSON Schema).

### 5.1 REST Endpoints (Spring Boot)

```http
POST /api/v1/boards
```

Creates a new board and returns `{ "boardId": "brd_8x92k", "createdAt": "..." }`. Rate-limited per IP.

```http
GET /api/v1/boards/{boardId}/snapshot
```

Returns the latest compacted CRDT state map and `snapshotSeq` (the latest server sequence number included in the snapshot), for fast initial hydration.

```http
GET /api/v1/boards/{boardId}/ops?sinceSeq={seq}&limit=1000
```

Fallback HTTP endpoint for fetching missed operations in pages after a long offline period.

### 5.2 WebSocket Frame Contracts

**Endpoint:** `wss://{host}/ws/boards/{boardId}?clientId={nodeId}`

**1. Client -> Server: Push CRDT Deltas (`SYNC_PUSH`)**

```json
{
  "type": "SYNC_PUSH",
  "clientId": "user_a_9f2",
  "ops": [
    { "objectId": "rect_01", "field": "x", "value": 420.5, "hlc": "1732579200450:00000:user_a_9f2" },
    { "objectId": "rect_01", "field": "y", "value": 180.0, "hlc": "1732579200450:00001:user_a_9f2" }
  ]
}
```

**2. Server -> All Clients incl. Origin: Broadcast Applied Deltas (`SYNC_BROADCAST`)**

```json
{
  "type": "SYNC_BROADCAST",
  "serverSeqStart": 1041,
  "serverSeqEnd": 1042,
  "originClientId": "user_a_9f2",
  "ops": [ ... ]
}
```

Ops in the batch are numbered `serverSeqStart..serverSeqEnd` in order. The origin client treats this message as its ack.

**3. Client -> Server: Reconnection Catch-Up (`SYNC_PULL`)**

```json
{ "type": "SYNC_PULL", "lastSyncedSeq": 1015 }
```

The server replies with one or more `SYNC_BROADCAST` frames covering `(1015, latest]`, or with `SNAPSHOT_REQUIRED`.

**4. Server -> Client: Snapshot Required (`SNAPSHOT_REQUIRED`)**

```json
{ "type": "SNAPSHOT_REQUIRED", "oldestAvailableSeq": 5200 }
```

**5. Server -> Client: Error (`ERROR`)**

```json
{ "type": "ERROR", "code": "CLOCK_SKEW | INVALID_FIELD | FRAME_TOO_LARGE | BOARD_FULL", "message": "..." }
```

**6. Bidirectional: Ephemeral Presence (`PRESENCE`)**

```json
{
  "type": "PRESENCE",
  "clientId": "user_a_9f2",
  "displayName": "User A",
  "color": "#EF4444",
  "cursor": { "x": 512, "y": 304 },
  "selectedIds": ["rect_01"]
}
```

---

## 6. Database & Storage Schema

### 6.1 PostgreSQL Schema

```sql
CREATE TABLE boards (
    id VARCHAR(64) PRIMARY KEY,
    title VARCHAR(128) NOT NULL DEFAULT 'Untitled Board',
    is_demo BOOLEAN NOT NULL DEFAULT TRUE,
    next_seq BIGINT NOT NULL DEFAULT 0,          -- per-board sequence counter (see 6.2)
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Periodic compacted state to prevent replaying millions of historical ops
CREATE TABLE board_snapshots (
    board_id VARCHAR(64) PRIMARY KEY REFERENCES boards(id) ON DELETE CASCADE,
    last_server_seq BIGINT NOT NULL DEFAULT 0,
    state_json JSONB NOT NULL DEFAULT '{}'::jsonb, -- Map<objectId, Map<field, {value, hlc}>>
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Append-only operation log for incremental catch-up and auditing
CREATE TABLE crdt_operations (
    board_id VARCHAR(64) NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
    server_seq BIGINT NOT NULL,                  -- per-board, gap-free, commit-ordered
    object_id VARCHAR(64) NOT NULL,
    field_name VARCHAR(64) NOT NULL,
    field_value JSONB,
    hlc VARCHAR(64) NOT NULL,
    origin_client_id VARCHAR(64) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (board_id, server_seq)
);

-- Idempotency: a resent op (e.g., client retried after a dropped ack) is not stored twice
CREATE UNIQUE INDEX uq_crdt_ops_idem ON crdt_operations (board_id, object_id, field_name, hlc);
```

### 6.2 Sequencing & Snapshot Compaction Strategy

* **Why not a global `BIGSERIAL`:** With multiple nodes, transactions can commit in a different order than they drew sequence values. A client might receive seq 105 and then catch up "since 105", even though seq 104 commits later and is never delivered. Sequence values can also have gaps after rollbacks.
* **Per-board sequencing:** Inside the write transaction, run `UPDATE boards SET next_seq = next_seq + :n WHERE id = :boardId RETURNING next_seq`. The row lock serializes writers **per board**, so seq order equals commit order and there are no gaps. Different boards never contend.
* **Dedup:** Ops that hit `uq_crdt_ops_idem` are skipped (`ON CONFLICT DO NOTHING`) and get no new seq.
* **Compaction:** Every **500 operations** per board (or on a scheduled task), Spring Boot folds uncompacted `crdt_operations` into `board_snapshots.state_json` using the same merge function, updates `last_server_seq`, and prunes ops that are both already in the snapshot and older than 24 hours. Clients that fall behind the pruned range are handled by `SNAPSHOT_REQUIRED` (FR-2.4).
* **Goal:** Initial board load stays under 100ms (snapshot + tail of ops) no matter how many edits the board has had.

### 6.3 Redis & IndexedDB Design

* **Redis Pub/Sub Channels:**
  * `board:ops:{boardId}`: carries `SYNC_BROADCAST` payloads across Spring Boot nodes.
  * `board:presence:{boardId}`: carries `PRESENCE` cursor updates.
* **IndexedDB (Client-Side, one database per replica):**
  * `registers` store: keyed by `[objectId, field]`, storing `{ value, hlc }`.
  * `outbox` store: auto-incrementing queue of unacked local ops, coalesced per register.
  * `meta` store: holds `nodeId`, `lastSyncedSeq`, and `lastHlc`.

---

## 7. Non-Functional Requirements, Testing & Resume Benchmarks

### 7.1 Mathematical Correctness (Property-Based Testing)

* **Cross-language parity:** `spec/vectors/*.json` holds golden cases (HLC tick/receive sequences, merge inputs → expected state hash). Both the TS (Vitest) and Java (JUnit 5) suites must pass the same vectors in CI.
* **Convergence (property-based):** Using `fast-check` (TS) and `jqwik` (Java), generate **10,000+ randomized concurrent operations** across 5 simulated replicas, with random partitions, duplicated delivery, dropped messages (later retried), and out-of-order delivery.
* **Assertion:** After all replicas exchange every op, each replica's canonical state hash must be **identical**. The hash is computed over registers sorted by `(objectId, field)`.
* **Integration test:** Docker Compose with 2 Spring Boot nodes. Clients on different nodes converge, including after a forced Redis disconnect, which exercises the gap-detection path.

### 7.2 Performance & Scalability Targets

* **Local Input-to-Render Latency:** Less than 16ms (60 FPS) for up to 1,000 objects on canvas.
* **End-to-End Sync Latency (Online):** Less than 50ms p99 between User A and User B when both clients, the backend VM, and Postgres are in the same region. The README must state the measurement setup.
* **WebSocket Concurrency Benchmark:** Load-test the Spring Boot backend with **k6**, run from a separate machine, simulating 1,000+ concurrent WebSocket users that broadcast cursor and shape mutations across 2 Spring Boot instances synced through Redis Pub/Sub. Publish p50/p95/p99 latency, throughput (ops/sec), and memory/CPU usage in the README, along with the instance size.

### 7.3 Guardrails & Abuse Prevention

* **Payload Size Limits:** Individual WebSocket frames are capped at 64KB, and each demo board allows at most 500 objects.
* **Rate Limits:** Max ~60 `SYNC_PUSH` frames/sec and 30 `PRESENCE` frames/sec per connection, plus a per-IP limit on board creation.
* **Demo Board Hygiene:** Anonymous playground boards older than 24 hours are expired and cleaned up automatically.

---

## 8. Implementation Roadmap (part-time, ~12–15 hrs/week)

* **Week 1: CRDT & HLC Core (TS first, then Java)**
  * `HlcClock` + `LwwMap` in `packages/sync-engine` with unit tests and fast-check convergence tests.
  * Port to Java, add `spec/vectors/`, and get both suites green against the same vectors.
* **Week 2: Single-Node Backend + Persistence**
  * Spring Boot WebSocket handler, `SYNC_PUSH`/`SYNC_BROADCAST`/`SYNC_PULL`, per-board sequencing, Postgres op log (Flyway migrations), and validation and clock-skew guard.
* **Week 3: Canvas MVP + Local-First**
  * Next.js SVG canvas with pan/zoom, rect/ellipse/arrow, freehand, text, select/move/resize, and the property bar.
  * IndexedDB persistence, outbox with coalescing, reconnect with backoff, and gap detection.
* **Week 4: Multi-Node + Presence**
  * Redis Pub/Sub fan-out, Docker Compose with 2 nodes + Caddy, live cursors, and the integration convergence test.
* **Week 5: Playground + Inspector + Deploy**
  * Split-screen panes, Kill Network toggles, Run Conflict Demo, and the CRDT Inspector.
  * Deploy the frontend to Vercel and the backend VM with HTTPS/WSS. Add snapshot compaction + `SNAPSHOT_REQUIRED`.
* **Week 6: Benchmarks & Documentation**
  * k6 load tests, latency numbers, an architecture README with diagrams, a "Design Decisions" section (§9), and a 90-second demo video.
* **Weeks 7–8 (P1):** Undo/redo, latency slider, multi-select, duplicate, diamond, sticky notes, opacity.

---

## 9. Key Design Decisions & Trade-offs (README / Interview Prep)

| Decision | Alternative | Why this choice |
| --- | --- | --- |
| State-based **LWW-Map CRDT** | Operational Transformation (Google Docs), server-authoritative (Figma) | Works offline with no central arbiter. A whiteboard's state is mostly independent fields, where LWW is the semantics users expect. |
| **HLC** timestamps | Lamport clocks, vector clocks, wall clock | Total order like Lamport, but close to wall-clock time, so the "last write" is intuitive. O(1) size, unlike vector clocks. |
| **Field-level** registers | Whole-object LWW | Concurrent edits to different properties of the same shape both survive. |
| **Per-board sequence** in Postgres | Global `BIGSERIAL`, Kafka offsets | Gap-free and commit-ordered, which makes catch-up correct. Per-board locking means boards never contend. |
| **Redis Pub/Sub** (best-effort) + seq gap detection | Redis Streams / Kafka | Simplest fan-out. Correctness lives in the protocol, not the broker. Streams would be the next step if replay from the broker were needed. |
| **Delete-wins tombstones**, no GC | Add-wins, tombstone GC | Prevents zombie objects. GC needs causal-stability tracking, which is out of scope. |
| **LWW for text** | RGA / Fugue sequence CRDT | Scope control. This is a known limitation, and the upgrade path is documented. |

---

## 10. Changelog (v1.0 → v1.1)

* Reworded the problem statement and server role to be technically accurate. Figma is server-authoritative, and the server here relays and stores ops but does not decide conflicts.
* **Ack mechanism:** The origin client now receives its own broadcast as its ack. Previously the origin was excluded, so the outbox could never be safely cleared.
* **Sequencing:** Replaced the global `BIGSERIAL` with a gap-free per-board sequence. Under concurrent commits, `BIGSERIAL` order can differ from commit order, which breaks `sinceSeq` catch-up.
* Added **gap detection**, because Redis Pub/Sub is best-effort and can deliver out of order across nodes.
* Added **`SNAPSHOT_REQUIRED`** fallback for clients that fall behind pruned ops, plus a merge-not-replace rule that protects offline edits.
* Spelled out the exact **HLC receive rule**, added a **clock-skew guard**, counter overflow handling, and widened the counter to 5 digits.
* Clarified tombstone semantics (delete-wins for visibility, no GC) and the fractional-index tie-break.
* Added outbox **coalescing**, a server-side **idempotency** index, field whitelist validation, rate limits, and an `ERROR` frame.
* Playground: a fresh board per visitor, an isolated IndexedDB per pane, and a `Transport` abstraction for Kill Network and latency simulation.
* Undo now only reverts a register if the current user still owns its latest write.
* Deployment: replaced Render/Railway free tiers with an always-on VM. Sleeping free tiers cause 30–60s cold starts that make a recruiter demo look broken.
* Added P0/P1 prioritization, a monorepo layout, cross-language test vectors, and a realistic part-time roadmap.

**v1.1 errata (2026-11-26, from the T01 protocol review; details in `spec/protocol.md`):**

* The clock-skew guard is enforced by the server only. Clients always merge broadcast ops, because dropping them based on local clocks would break convergence.
* Acks are per op: a client acks any broadcast op whose HLC `nodeId` is its own. `originClientId` is informational, since catch-up pages mix ops from many clients.
