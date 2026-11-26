# SyncCanvas Wire Protocol & CRDT Specification

**Version:** 1.0 (derived from `PRD.md` v1.1 and `IMPLEMENTATION_PLAN.md` §2)

This document is the **single source of truth** for SyncCanvas's CRDT semantics, Hybrid Logical Clock (HLC) rules, ID formats, field whitelist, limits, and WebSocket/REST wire contracts. Both the TypeScript client (`packages/sync-engine`) and the Java server (`server/`) must conform identically to this specification and pass all golden vectors in `spec/vectors/*.json`.

**String ordering:** every "lexicographic" comparison in this document means **UTF-16 code unit order** (JS `<` on strings, Java `String.compareTo`). All IDs, field names, and HLC strings are ASCII, so this is also byte order.

---

## 1. Identifiers & Formats

| Identifier            | Validation pattern               | Example                          | Notes                                                                                             |
| --------------------- | -------------------------------- | -------------------------------- | ------------------------------------------------------------------------------------------------- |
| `nodeId` / `clientId` | `^[a-z0-9_]{1,32}$`              | `user_a_9f2`                     | Cannot contain `:`. Globally unique per client replica (per browser + per playground pane).       |
| `objectId`            | `^[a-z0-9_]{1,64}$`              | `obj_91f2a7k3m0`                 | Clients **generate** `obj_` + 10 random base36 chars; the server only enforces the loose pattern. |
| `boardId`             | `^brd_[a-z0-9]{8}$`              | `brd_8x92k4p1`                   | Generated server-side (`brd_` + 8 random base36 chars).                                           |
| `hlc`                 | `^\d{13}:\d{5}:[a-z0-9_]{1,32}$` | `1732579200450:00001:user_a_9f2` | `{13-digit-zero-padded-ms}:{5-digit-zero-padded-counter}:{nodeId}`.                               |
| `field`               | `^[a-zA-Z0-9]{1,64}$`            | `strokeWidth`                    | Must additionally be in the whitelist (§4).                                                       |

---

## 2. Hybrid Logical Clock (HLC) Semantics

Each HLC is a tuple `(physicalTime: int64 ms, counter: int32, nodeId: string)`.

### 2.1 Serialization & Total Order

- Serialized form: `{13-digit zero-padded physicalTime}:{5-digit zero-padded counter}:{nodeId}`.
- `compareHlc(a, b)` compares `physicalTime` (numeric), then `counter` (numeric), then `nodeId` (lexicographic).
- Because `physicalTime` and `counter` are fixed-width and `nodeId` cannot contain `:`, comparing the serialized strings lexicographically gives the same result as comparing the tuples, for all `physicalTime < 10^13` ms.

### 2.2 Initial State

If no `initial` HLC is supplied, the clock starts at `last = (0, 0, nodeId)`, i.e. `0000000000000:00000:{nodeId}`. Clients persist `last` in IndexedDB `meta.lastHlc` and pass it as `initial` after a reload.

### 2.3 Local Tick Rule (`tick()`)

Given injected `now = currentPhysicalTimeMs()` and previous clock state `last`:

1. If `now > last.physicalTime`: `physicalTime = now`, `counter = 0`.
2. Else: `physicalTime = last.physicalTime`, `counter = last.counter + 1`.
3. Apply **Counter Overflow** (§2.5).
4. Store `last = (physicalTime, counter, localNodeId)` and return `formatHlc(last)`.

### 2.4 Receive Rule (`receive(remote)`) — Kulkarni et al. (2014)

Given `now = currentPhysicalTimeMs()`, local `last`, and remote HLC `r`:

1. **Clock-Skew Guard:** if `r.physicalTime > now + MAX_DRIFT_MS` (default `60_000`), throw `ClockSkewError` and do **not** change `last`.
2. `pt = max(now, last.physicalTime, r.physicalTime)`.
3. Counter:
   - if `pt == last.physicalTime && pt == r.physicalTime` → `counter = max(last.counter, r.counter) + 1`
   - else if `pt == last.physicalTime` → `counter = last.counter + 1`
   - else if `pt == r.physicalTime` → `counter = r.counter + 1`
   - else (`now` strictly greatest) → `counter = 0`
4. Apply **Counter Overflow** (§2.5).
5. Store `last = (pt, counter, localNodeId)`.

### 2.5 Counter Overflow

If `counter > 99999`: `physicalTime = physicalTime + 1`, `counter = 0`.

### 2.6 Who Enforces the Skew Guard

- **Server (authoritative):** before persisting, every op in a `SYNC_PUSH` is checked against the server clock. A violation rejects the frame with `ERROR CLOCK_SKEW` (§5.4).
- **Clients (never drop):** every op delivered in a `SYNC_BROADCAST` has already passed the server check, so a client **must always merge it** into its `LwwMap`. If `clock.receive()` throws `ClockSkewError` (because the client's own clock is behind), the client catches it, leaves its clock unchanged, still applies the op, and emits a `SyncEvent { kind: "error", code: "CLOCK_SKEW" }`.
- **Why:** if clients discarded ops based on their local clocks, replicas with different clocks would keep different sets of ops and never converge.

---

## 3. LWW-Map CRDT Semantics

### 3.1 Register Model & Merge Rule

- Every canvas object is a map of independent LWW-Registers keyed by `(objectId, field)`. Each register stores `{ value, hlc }`.
- **Merge rule (`apply(op)`):**
  - No register for `(op.objectId, op.field)` → store `{ value: op.value, hlc: op.hlc }` → `ACCEPTED`.
  - Existing register `cur` and `compareHlc(op.hlc, cur.hlc) > 0` → replace → `ACCEPTED` (with `previous: cur`).
  - Otherwise (`compareHlc(op.hlc, cur.hlc) <= 0`) → keep `cur` → `DISCARDED_STALE`.
- `apply` does no validation; it is a pure merge. This makes it **commutative**, **associative**, and **idempotent**.

### 3.2 Object Existence, Tombstones & Z-Order

- **Existence:** an object is visible only if it has a `type` register **and** its `deleted` register is absent or `false`.
- **Delete-wins tombstones:** `deleted = true` hides the object regardless of concurrent edits to other fields. Only `deleted = false` with a strictly greater HLC undeletes it. Tombstones are kept for the board's lifetime (no GC in v1).
- **Z-order:** `visibleObjectIds()` sorts visible objects by `(zIndex, objectId)` lexicographically. An object with no `zIndex` register sorts as `zIndex = ""` (first).

### 3.3 Canonical State Hash (Cross-Language Parity)

1. Collect every register (including those of deleted objects) as a tuple `[objectId, field, value, hlc]`.
2. Sort by `objectId`, then `field` (lexicographic).
3. Serialize the sorted array with **RFC 8785 JSON Canonicalization Scheme (JCS)**.
4. Hash = **SHA-256** of the UTF-8 bytes, as 64 lowercase hex characters.

---

## 4. Field Whitelist & Validation

The **server** validates every op in a `SYNC_PUSH` frame. Clients and `LwwMap.apply` do not validate (§3.1).

### 4.1 Validation Algorithm (per op, in frame order)

1. `objectId`, `field`, and `hlc` match their patterns (§1). The HLC's `nodeId` equals the session's `clientId`.
2. Skew guard (§2.6).
3. **Resolve the object's type:** use the value of a `type` op for the same `objectId` that appears earlier in the same frame; otherwise use the `type` register in the server's board state; otherwise the type is **unknown**.
4. **`type` is write-once:** a `type` op is valid only if its value is in the enum and the object has no existing `type`, or the existing `type` is identical (a resend). Changing the type of an existing object is rejected.
5. If `field` is a common field (§4.2), validate its value.
6. Otherwise, if the type is **unknown**, or `field` is not allowed for that type (§4.3), reject.
7. `null` is not a valid value for any field. (`null` remains in the `FieldValue` type for forward compatibility only.)

There are no "required at creation" checks on the server. The client writes every initial field in one `mutate` batch, and renderers use the defaults below for missing fields.

### 4.2 Common Fields (All Object Types)

| field         | type      | default        | constraints                                                                             |
| ------------- | --------- | -------------- | --------------------------------------------------------------------------------------- |
| `type`        | `string`  | — (write-once) | Enum: `"rect"`, `"ellipse"`, `"arrow"`, `"freehand"`, `"text"`, `"diamond"`, `"sticky"` |
| `x`           | `number`  | `0`            | Finite                                                                                  |
| `y`           | `number`  | `0`            | Finite                                                                                  |
| `zIndex`      | `string`  | `""`           | 1–64 chars from `[0-9A-Za-z]` (fractional-index key)                                    |
| `deleted`     | `boolean` | `false`        | —                                                                                       |
| `stroke`      | `string`  | `"#1f2937"`    | `^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$` or `"transparent"`                                 |
| `strokeWidth` | `number`  | `2`            | `0.5 <= strokeWidth <= 32`                                                              |
| `opacity`     | `number`  | `1`            | `0 <= opacity <= 1`                                                                     |

### 4.3 Type-Specific Fields

#### `rect`, `ellipse`, `diamond`, `sticky`

| field  | type     | default                                  | constraints                                             |
| ------ | -------- | ---------------------------------------- | ------------------------------------------------------- |
| `w`    | `number` | `1`                                      | `w > 0`, finite                                         |
| `h`    | `number` | `1`                                      | `h > 0`, finite                                         |
| `fill` | `string` | `"transparent"` (`"#fef08a"` for sticky) | `^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$` or `"transparent"` |

#### `arrow`

| field       | type     | default | constraints                       |
| ----------- | -------- | ------- | --------------------------------- |
| `x2`        | `number` | `x`     | Finite                            |
| `y2`        | `number` | `y`     | Finite                            |
| `arrowHead` | `string` | `"end"` | Enum: `"none"`, `"end"`, `"both"` |

#### `freehand`

| field    | type                             | default | constraints                                                                        |
| -------- | -------------------------------- | ------- | ---------------------------------------------------------------------------------- |
| `points` | `Point[]` (`[number, number][]`) | `[]`    | `1 <= length <= 2000`; each point is a pair of finite numbers relative to `(x, y)` |

#### `text`, `sticky`

| field      | type     | default | constraints                        |
| ---------- | -------- | ------- | ---------------------------------- |
| `text`     | `string` | `""`    | `length <= 2000` UTF-16 code units |
| `fontSize` | `number` | `16`    | `8 <= fontSize <= 128`             |

### 4.4 Object Limit (`BOARD_FULL`)

A board's object count is the number of distinct `objectId`s that have a `type` register, **including deleted objects** (tombstones are never collected). A `type` op that would create object number 501 or later is rejected with `BOARD_FULL`, together with every other op in the frame for that `objectId`.

---

## 5. Wire Protocol

### 5.1 REST Endpoints

Errors use RFC 7807 `application/problem+json`.

- `POST /api/v1/boards`: creates a board (rate-limited per IP to 10/min).
  - `201 Created`: `{ "boardId": "brd_8x92k4p1", "createdAt": "2026-01-01T00:00:00Z" }`
- `GET /api/v1/boards/{boardId}/snapshot`: returns the board's full current state.
  - `200 OK`: `{ "state": SnapshotState, "snapshotSeq": 5200 }`. `snapshotSeq` is the highest `serverSeq` included in `state`.
- `GET /api/v1/boards/{boardId}/ops?sinceSeq={seq}&limit={limit}`: paged catch-up over HTTP (`1 <= limit <= 1000`, default `500`).
  - `200 OK`: `{ "ops": [{ "serverSeq": 101, "op": Op }], "hasMore": false }`
  - `410 Gone` if `sinceSeq < oldestAvailableSeq - 1`. The client must fetch the snapshot instead.
- `404 Not Found` for unknown boards on every endpoint.

### 5.2 WebSocket Endpoint

`wss://{host}/ws/boards/{boardId}?clientId={nodeId}`

- Rejects unknown `boardId` or an invalid `clientId`.
- All frames are UTF-8 JSON text frames that conform to `spec/schema/*.schema.json`.

### 5.3 Sequencing Definitions

- `serverSeq`: a per-board, gap-free, commit-ordered integer starting at `1`.
- `oldestAvailableSeq`: the smallest `serverSeq` still in the op log. If the log is empty (a new board, or everything pruned into the snapshot), it is `latestSeq + 1` (`1` for a new board).

### 5.4 WebSocket Messages

#### 1. `SYNC_PUSH` (Client → Server)

Schema: `spec/schema/sync-push.schema.json`

```json
{
  "type": "SYNC_PUSH",
  "clientId": "user_a_9f2",
  "ops": [
    {
      "objectId": "obj_91f2a7k3m0",
      "field": "x",
      "value": 420.5,
      "hlc": "1732579200450:00000:user_a_9f2"
    }
  ]
}
```

- `clientId` must equal the WebSocket `clientId` query parameter and the `nodeId` of every op's `hlc`.
- **Atomic frames:** the server validates the whole frame (§4.1). If any op is invalid, **nothing** from the frame is stored, and the server replies with one `ERROR` whose `rejectedHlcs` lists the invalid ops (§5.4.5).
- **Dedup:** ops already stored (same `(objectId, field, hlc)`) are skipped and get no new seq. If every op in a frame is a duplicate, no broadcast is sent. That is safe because the client always sends `SYNC_PULL` before flushing its outbox (§5.5), so it receives the earlier broadcast of those ops.

#### 2. `SYNC_BROADCAST` (Server → Clients)

Schema: `spec/schema/sync-broadcast.schema.json`

```json
{
  "type": "SYNC_BROADCAST",
  "serverSeqStart": 1041,
  "serverSeqEnd": 1042,
  "originClientId": "user_a_9f2",
  "ops": [ ... ]
}
```

- `ops[i]` has `serverSeq = serverSeqStart + i`. Invariants (checked in code, since JSON Schema can't express them): `serverSeqStart <= serverSeqEnd` and `ops.length == serverSeqEnd - serverSeqStart + 1`.
- **Live fan-out** (result of a `SYNC_PUSH`): sent to **every** session on the board, including the origin. `originClientId` is the pushing client.
- **Catch-up replies** (to a `SYNC_PULL`): sent only to the requester, and may contain ops from many clients. `originClientId` is then `"server"`.
- `originClientId` is **informational only** (e.g. for the Inspector). It is never used for acks (§5.5).
- **Catch-up page size:** at most **500 ops** and at most **256 KiB** of serialized JSON per frame, whichever limit is reached first. A single op always fits, because inbound frames are limited to 64 KiB.

#### 3. `SYNC_PULL` (Client → Server)

Schema: `spec/schema/sync-pull.schema.json`

```json
{ "type": "SYNC_PULL", "lastSyncedSeq": 1015 }
```

- If `lastSyncedSeq < oldestAvailableSeq - 1`, the server replies `SNAPSHOT_REQUIRED`.
- Otherwise it replies with zero or more `SYNC_BROADCAST` pages covering `(lastSyncedSeq, latestSeq]`, in order.

#### 4. `SNAPSHOT_REQUIRED` (Server → Client)

Schema: `spec/schema/snapshot-required.schema.json`

```json
{ "type": "SNAPSHOT_REQUIRED", "oldestAvailableSeq": 5200 }
```

- The client fetches `GET /snapshot`, **merges** every register into its `LwwMap` with `apply` (never replacing local state), sets `lastSyncedSeq = snapshotSeq`, sends `SYNC_PULL`, and then flushes its outbox.
- Outbox ops that were already pruned from the server's log will be stored again with new seqs when resent. That is harmless because merge is idempotent.

#### 5. `ERROR` (Server → Client)

Schema: `spec/schema/error.schema.json`

```json
{
  "type": "ERROR",
  "code": "INVALID_FIELD",
  "message": "field 'w' not allowed for type 'arrow'",
  "rejectedHlcs": ["1732579200450:00000:user_a_9f2"]
}
```

| `code`            | Meaning                                                         | `rejectedHlcs` | Client action                                                           |
| ----------------- | --------------------------------------------------------------- | -------------- | ----------------------------------------------------------------------- |
| `CLOCK_SKEW`      | op `physicalTime > serverNow + MAX_DRIFT_MS`                    | yes            | Keep the ops in the outbox; retry on the next flush/reconnect.          |
| `INVALID_FIELD`   | bad pattern, unknown/disallowed field, bad value, `type` change | yes            | Remove the `rejectedHlcs` ops from the outbox (they can never succeed). |
| `BOARD_FULL`      | creating the op's object would exceed 500 objects (§4.4)        | yes            | Remove the `rejectedHlcs` ops from the outbox.                          |
| `FRAME_TOO_LARGE` | inbound frame > 64 KiB; the server then closes the socket       | no             | Reconnect; flush in smaller frames.                                     |
| `RATE_LIMITED`    | per-session token bucket exhausted; the frame is dropped        | no             | Back off and retry.                                                     |
| `INVALID_MESSAGE` | malformed JSON, unknown `type`, or schema violation             | no             | Bug: log it.                                                            |
| `BOARD_NOT_FOUND` | the board does not exist; the server then closes the socket     | no             | Show the "board not found" state.                                       |

- Ops in a rejected frame that are **not** in `rejectedHlcs` were not stored either; they stay in the outbox and are sent again on the next flush.
- **Known limitation:** ops removed from the outbox after `INVALID_FIELD` or `BOARD_FULL` remain in the client's local state only. That client's state can then differ from other replicas until it reloads from the snapshot. In practice this only happens with client bugs or abuse.

#### 6. `PRESENCE` (Bidirectional, Ephemeral)

Schema: `spec/schema/presence.schema.json`

```json
{
  "type": "PRESENCE",
  "clientId": "user_a_9f2",
  "displayName": "User A",
  "color": "#EF4444",
  "cursor": { "x": 512, "y": 304 },
  "selectedIds": ["obj_91f2a7k3m0"]
}
```

- Never persisted and never merged into CRDT state.
- `clientId` must match the session. The server relays the message to every other session on the board (excluding the origin) through `board:presence:{boardId}`.
- `cursor: null` means the client left. The server sends it on session close. Clients also hide a remote cursor after 5 s without an update.

### 5.5 Client Ack Rule & (Re)connect Order

- **Ack rule:** for every op in any `SYNC_BROADCAST` (live or catch-up), if the `nodeId` in the op's `hlc` equals the client's own `nodeId`, the client removes that HLC from its outbox. (Coalescing may already have replaced it with a newer HLC; removing an absent HLC does nothing.)
- **Order on every (re)connect:** send `SYNC_PULL { lastSyncedSeq }` → apply the catch-up pages (acking as above) → flush the outbox.
- **Gaps:** if a broadcast arrives with `serverSeqStart > lastSyncedSeq + 1`, buffer it and send `SYNC_PULL` (at most one in flight). If `serverSeqEnd <= lastSyncedSeq`, ignore it. If it partially overlaps (`serverSeqStart <= lastSyncedSeq < serverSeqEnd`), apply only the ops with `serverSeq > lastSyncedSeq`.

---

## 6. Redis Pub/Sub & Client IndexedDB Layout

### 6.1 Redis Channels

- `board:ops:{boardId}`: `SYNC_BROADCAST` envelopes between Spring Boot nodes.
- `board:presence:{boardId}`: `PRESENCE` envelopes between nodes, tagged internally with `nodeInstanceId` so a node doesn't re-deliver its own messages.

### 6.2 Client IndexedDB (One Database per Replica)

- Database name: `synccanvas_{boardId}_{paneId}`
- `registers`: key `[objectId, field]` → `{ value, hlc }`.
- `outbox`: key `objectId|field` → the latest unacked local op for that register (coalesced; keeps the max HLC).
- `meta`: `{ nodeId, lastSyncedSeq, lastHlc }`.

---

## 7. Limits & Guardrails

| Guardrail                               | Limit                                          |
| --------------------------------------- | ---------------------------------------------- |
| Max **inbound** (client → server) frame | 64 KiB (`65_536` bytes)                        |
| Max outbound catch-up page              | 500 ops or 256 KiB, whichever is reached first |
| Max objects per board                   | 500 (counting deleted objects)                 |
| Max HLC future drift (`MAX_DRIFT_MS`)   | `60_000` ms                                    |
| Max `SYNC_PUSH` rate per session        | 60 frames/s                                    |
| Max `PRESENCE` rate per session         | 30 frames/s                                    |
| Max board creations per IP              | 10/min                                         |
| Max freehand points per stroke          | 2,000                                          |
| Max text length per object              | 2,000 UTF-16 code units                        |
| Demo board TTL                          | 24 hours                                       |
