# SyncCanvas — Architecture Deep Dive

This document complements `spec/protocol.md` and explains the distributed-systems mechanisms inside SyncCanvas.

## 1. Hybrid Logical Clocks (HLC)

Each replica maintains `last = (physicalTime, counter, nodeId)` formatted as `{13-digit ms}:{5-digit counter}:{nodeId}`. Because `physicalTime` and `counter` are fixed-width zero-padded decimals and `nodeId` matches `^[a-z0-9_]{1,32}$` (no colons), plain UTF-16/ASCII string comparison defines a strict total order identical to tuple comparison.

- **`tick()`:** advances `physicalTime = max(now, last.physicalTime)`; resets `counter = 0` when `now` advances, else increments `counter` with carry into `physicalTime` on overflow (`> 99999`).
- **`receive(remote)` (Kulkarni et al. 2014):** enforces `remote.physicalTime <= now + 60_000ms` on the server, then merges `pt = max(now, last.pt, remote.pt)` with the 4-branch counter rule.
- **Server-only skew enforcement:** Clients never drop a `SYNC_BROADCAST` op even if their local clock is behind and `clock.receive()` throws `ClockSkewError` — they log/emit the error, leave the local clock unchanged, and still apply the op to `LwwMap` so replicas never diverge.

## 2. Field-Level LWW-Map & JCS State Hash

Every canvas object is a map of independent registers `(objectId, field) → { value, hlc }`:

- `apply(op)` replaces the register strictly when `compareHlc(op.hlc, current.hlc) > 0`.
- Visibility: an object is visible iff it has a `type` register and `deleted !== true` (delete-wins tombstones).
- Ordering: `visibleObjectIds()` sorts by `(zIndex, objectId)` using fractional indexing (`fractional-indexing`).
- **State hash:** collect all `[objectId, field, value, hlc]` tuples (including tombstones), sort by `(objectId, field)`, canonicalize with RFC 8785 JCS (`canonicalize` in TS, `java-json-canonicalization` in Java), and compute lowercase hex SHA-256.

## 3. Per-Board Gap-Free Sequencing

Global `BIGSERIAL` sequences suffer from two issues in collaborative sync:

1. **Commit-order skew:** Transaction A allocates seq 10, Transaction B allocates seq 11 and commits first; a client polling `sinceSeq = 9` sees 11, advances `lastSyncedSeq = 11`, and permanently misses 10.
2. **Cross-board lock contention:** Busy boards serialize unrelated boards.

SyncCanvas instead locks the single `boards` row (`SELECT next_seq FROM boards WHERE id = :boardId FOR UPDATE`), filters intra-batch and already-persisted `(object_id, field_name, hlc)` duplicates, reserves `n` contiguous seqs (`UPDATE boards SET next_seq = next_seq + :n RETURNING next_seq`), and batch-inserts into `crdt_operations`. Writers to the same board commit in exact sequence order with zero gaps; writers to different boards run in parallel.

## 4. Multi-Node Fan-Out & Gap Recovery

- **Local vs Redis Bus:** `BoardBus` abstracts fan-out (`LocalBoardBus` for single-node dev/tests, `RedisBoardBus` for multi-node). `RedisBoardBus` dynamically subscribes to `board:ops:{boardId}` and `board:presence:{boardId}` when the first local session joins and unsubscribes when the last leaves.
- **Presence echo prevention:** `RedisBoardBus` tags `PRESENCE` envelopes with `nodeInstanceId`, delivers locally immediately, and skips its own `nodeInstanceId` on Redis receive.
- **Gap detection:** Redis Pub/Sub is best-effort. Clients track contiguous `lastSyncedSeq`. If a broadcast arrives with `serverSeqStart > lastSyncedSeq + 1`, `SyncClient` buffers it and sends `SYNC_PULL { lastSyncedSeq }`. Once the missing range arrives, buffered frames drain in order.
- **Compaction & `SNAPSHOT_REQUIRED`:** `CompactionJob` periodically upserts `board_snapshots` and prunes ops older than 24h. Clients whose `lastSyncedSeq < oldestAvailableSeq - 1` receive `SNAPSHOT_REQUIRED`, fetch `GET /api/v1/boards/{id}/snapshot`, **merge** every register via `LwwMap.apply()` (preserving unsynced offline edits), advance `lastSyncedSeq = snapshotSeq`, pull any tail ops, and flush their outbox.

## 5. Client Offline Outbox & Render Isolation

- **Coalesced outbox:** IndexedDB (`synccanvas_{boardId}_{paneId}`) stores `outbox` keyed by `objectId|field`, keeping the max HLC. Dragging a shape 300 frames while offline produces 600 local mutations that coalesce to just 2 outbox ops (`x` and `y`).
- **Per-object React subscriptions:** `SyncStore` caches referentially stable snapshots per `objectId` for React 19's `useSyncExternalStore`, so moving one shape re-renders only that memoized `<ShapeNode />`.
