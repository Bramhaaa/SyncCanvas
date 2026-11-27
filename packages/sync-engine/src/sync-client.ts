import { createEmitter } from "./emitter.js";
import { ClockSkewError, compareHlc, parseHlc } from "./hlc.js";
import { createLwwMap } from "./lww-map.js";
import type {
  ErrorMessage,
  ServerMessage,
  SnapshotResponse,
  SyncBroadcastMessage,
} from "./protocol.js";
import type {
  ConnStatus,
  HlcString,
  Op,
  SyncClient,
  SyncClientOptions,
  SyncEvent,
} from "./types.js";

const DEFAULT_FLUSH_INTERVAL_MS = 40;
/** Safe outbound frame payload cap below the 64 KiB server limit. */
const MAX_PUSH_FRAME_BYTES = 56_000;

function outboxKey(objectId: string, field: string): string {
  return `${objectId}|${field}`;
}

function arraysEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

function utf8ByteLength(str: string): number {
  return new TextEncoder().encode(str).byteLength;
}

export function createSyncClient(options: SyncClientOptions): SyncClient {
  const {
    boardId,
    nodeId,
    storage,
    transport,
    clock,
    flushIntervalMs = DEFAULT_FLUSH_INTERVAL_MS,
    apiBaseUrl = "",
  } = options;

  const fetchSnapshot: () => Promise<SnapshotResponse> =
    options.fetchSnapshot ??
    (async () => {
      const base = apiBaseUrl.replace(/\/$/, "");
      const res = await fetch(`${base}/api/v1/boards/${encodeURIComponent(boardId)}/snapshot`);
      if (!res.ok) {
        throw new Error(`Failed to fetch snapshot: HTTP ${res.status}`);
      }
      return (await res.json()) as SnapshotResponse;
    });

  const map = createLwwMap();
  const emitter = createEmitter<SyncEvent>();
  const objectSubscribers = new Map<string, Set<() => void>>();
  const idSubscribers = new Set<() => void>();

  const outboxMap = new Map<string, Op>();
  const bufferedBroadcasts = new Map<number, SyncBroadcastMessage>();

  let lastSyncedSeq = 0;
  let lastVisibleIds: string[] = [];
  let connStatus: ConnStatus = "offline";
  let flushTimer: ReturnType<typeof setTimeout> | null = null;
  let pullInFlight = false;
  let snapshotInFlight = false;
  let started = false;
  let stopped = false;

  let unsubMessage: (() => void) | null = null;
  let unsubStatus: (() => void) | null = null;

  // Serialize async storage writes so ordering is preserved and stop() can await them.
  let persistChain: Promise<void> = Promise.resolve();

  function enqueuePersist(fn: () => Promise<void>): void {
    persistChain = persistChain.then(fn).catch((err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      emitter.emit({ kind: "error", code: "STORAGE_ERROR", message });
    });
  }

  function notifySubscribers(touchedObjectIds: Set<string>): void {
    for (const objectId of touchedObjectIds) {
      const subs = objectSubscribers.get(objectId);
      if (subs !== undefined) {
        for (const cb of subs) {
          cb();
        }
      }
    }

    const nextVisible = map.visibleObjectIds();
    if (!arraysEqual(lastVisibleIds, nextVisible)) {
      lastVisibleIds = nextVisible;
      for (const cb of idSubscribers) {
        cb();
      }
    }
  }

  function clearFlushTimer(): void {
    if (flushTimer !== null) {
      clearTimeout(flushTimer);
      flushTimer = null;
    }
  }

  function flushOutbox(): void {
    clearFlushTimer();
    if (stopped || connStatus !== "online" || snapshotInFlight || outboxMap.size === 0) {
      return;
    }

    const sortedOps = Array.from(outboxMap.values()).sort((a, b) => compareHlc(a.hlc, b.hlc));
    const chunks: Op[][] = [];
    let currentChunk: Op[] = [];
    const baseOverhead = utf8ByteLength(
      JSON.stringify({ type: "SYNC_PUSH", clientId: nodeId, ops: [] }),
    );
    let currentBytes = baseOverhead;

    for (const op of sortedOps) {
      const opBytes = utf8ByteLength(JSON.stringify(op)) + 1;
      if (currentChunk.length > 0 && currentBytes + opBytes > MAX_PUSH_FRAME_BYTES) {
        chunks.push(currentChunk);
        currentChunk = [];
        currentBytes = baseOverhead;
      }
      currentChunk.push(op);
      currentBytes += opBytes;
    }
    if (currentChunk.length > 0) {
      chunks.push(currentChunk);
    }

    for (const chunk of chunks) {
      transport.send({
        type: "SYNC_PUSH",
        clientId: nodeId,
        ops: chunk,
      });
      emitter.emit({ kind: "sent", ops: chunk });
    }
  }

  function scheduleFlush(): void {
    if (stopped || connStatus !== "online" || snapshotInFlight || outboxMap.size === 0) {
      return;
    }
    if (flushTimer !== null) return;

    if (flushIntervalMs <= 0) {
      flushOutbox();
      return;
    }

    flushTimer = setTimeout(() => {
      flushTimer = null;
      flushOutbox();
    }, flushIntervalMs);
  }

  function applyContiguousBroadcast(msg: SyncBroadcastMessage): void {
    if (msg.serverSeqEnd <= lastSyncedSeq) {
      return;
    }

    const startIdx = Math.max(0, lastSyncedSeq + 1 - msg.serverSeqStart);
    const appliedOps: Op[] = [];
    const ackedHlcs: HlcString[] = [];
    const touchedObjects = new Set<string>();

    for (let i = startIdx; i < msg.ops.length; i++) {
      const op = msg.ops[i]!;
      const seq = msg.serverSeqStart + i;

      // Server is authoritative for clock-skew; clients always merge broadcast ops (protocol §2.6).
      try {
        clock.receive(op.hlc);
      } catch (err: unknown) {
        if (err instanceof ClockSkewError) {
          emitter.emit({ kind: "error", code: "CLOCK_SKEW", message: err.message });
        } else {
          throw err;
        }
      }

      const result = map.apply(op);
      emitter.emit({ kind: "remote_op", op, seq, result });
      appliedOps.push(op);
      touchedObjects.add(op.objectId);

      // Per-op ack by HLC nodeId (protocol §5.5); originClientId is informational only.
      if (parseHlc(op.hlc).nodeId === nodeId) {
        const key = outboxKey(op.objectId, op.field);
        const pending = outboxMap.get(key);
        if (pending !== undefined && pending.hlc === op.hlc) {
          outboxMap.delete(key);
        }
        ackedHlcs.push(op.hlc);
      }
    }

    lastSyncedSeq = msg.serverSeqEnd;

    const seqSnapshot = lastSyncedSeq;
    const lastHlcSnapshot = clock.last();
    enqueuePersist(async () => {
      if (appliedOps.length > 0) {
        await storage.putRegisters(appliedOps);
      }
      if (ackedHlcs.length > 0) {
        await storage.outboxRemove(ackedHlcs);
      }
      await storage.setMeta({
        nodeId,
        lastSyncedSeq: seqSnapshot,
        lastHlc: lastHlcSnapshot,
      });
    });

    notifySubscribers(touchedObjects);

    if (ackedHlcs.length > 0) {
      emitter.emit({ kind: "acked", hlcs: ackedHlcs, seq: msg.serverSeqEnd });
      emitter.emit({ kind: "outbox", depth: outboxMap.size });
    }
  }

  function drainBufferedBroadcasts(): void {
    while (bufferedBroadcasts.size > 0) {
      const starts = Array.from(bufferedBroadcasts.keys()).sort((a, b) => a - b);
      let progressed = false;

      for (const start of starts) {
        const msg = bufferedBroadcasts.get(start)!;
        if (msg.serverSeqEnd <= lastSyncedSeq) {
          bufferedBroadcasts.delete(start);
          progressed = true;
          continue;
        }
        if (msg.serverSeqStart <= lastSyncedSeq + 1) {
          bufferedBroadcasts.delete(start);
          applyContiguousBroadcast(msg);
          progressed = true;
          break;
        }
      }

      if (!progressed) break;
    }

    if (bufferedBroadcasts.size === 0) {
      pullInFlight = false;
    }
  }

  function handleSyncBroadcast(msg: SyncBroadcastMessage): void {
    if (msg.serverSeqEnd <= lastSyncedSeq) {
      return;
    }

    if (msg.serverSeqStart > lastSyncedSeq + 1) {
      bufferedBroadcasts.set(msg.serverSeqStart, msg);
      emitter.emit({
        kind: "gap_detected",
        expected: lastSyncedSeq + 1,
        got: msg.serverSeqStart,
      });
      if (!pullInFlight && connStatus === "online") {
        pullInFlight = true;
        transport.send({ type: "SYNC_PULL", lastSyncedSeq });
      }
      return;
    }

    applyContiguousBroadcast(msg);
    drainBufferedBroadcasts();
  }

  function handleSnapshotRequired(oldestAvailableSeq: number): void {
    emitter.emit({ kind: "snapshot_required", oldestAvailableSeq });
    if (snapshotInFlight) return;

    snapshotInFlight = true;
    clearFlushTimer();

    void (async () => {
      try {
        const snapshot = await fetchSnapshot();
        if (stopped) return;

        const mergedOps: Op[] = [];
        const touchedObjects = new Set<string>();

        for (const [objectId, fields] of Object.entries(snapshot.state)) {
          for (const [field, reg] of Object.entries(fields)) {
            const op: Op = { objectId, field, value: reg.value, hlc: reg.hlc };
            try {
              clock.receive(op.hlc);
            } catch (err: unknown) {
              if (err instanceof ClockSkewError) {
                emitter.emit({ kind: "error", code: "CLOCK_SKEW", message: err.message });
              } else {
                throw err;
              }
            }
            map.apply(op);
            mergedOps.push(op);
            touchedObjects.add(objectId);
          }
        }

        lastSyncedSeq = Math.max(lastSyncedSeq, snapshot.snapshotSeq);
        bufferedBroadcasts.clear();
        pullInFlight = false;

        const seqSnapshot = lastSyncedSeq;
        const lastHlcSnapshot = clock.last();
        enqueuePersist(async () => {
          if (mergedOps.length > 0) {
            await storage.putRegisters(mergedOps);
          }
          await storage.setMeta({
            nodeId,
            lastSyncedSeq: seqSnapshot,
            lastHlc: lastHlcSnapshot,
          });
        });

        notifySubscribers(touchedObjects);

        snapshotInFlight = false;
        if (!stopped && connStatus === "online") {
          transport.send({ type: "SYNC_PULL", lastSyncedSeq });
          scheduleFlush();
        }
      } catch (err: unknown) {
        snapshotInFlight = false;
        const message = err instanceof Error ? err.message : String(err);
        emitter.emit({ kind: "error", code: "SNAPSHOT_FETCH_FAILED", message });
      }
    })();
  }

  function handleError(msg: ErrorMessage): void {
    emitter.emit({ kind: "error", code: msg.code, message: msg.message });

    if (
      (msg.code === "INVALID_FIELD" || msg.code === "BOARD_FULL") &&
      msg.rejectedHlcs !== undefined &&
      msg.rejectedHlcs.length > 0
    ) {
      const rejected = new Set(msg.rejectedHlcs);
      let removedAny = false;
      for (const [key, op] of outboxMap) {
        if (rejected.has(op.hlc)) {
          outboxMap.delete(key);
          removedAny = true;
        }
      }
      const hlcs = [...msg.rejectedHlcs];
      enqueuePersist(async () => {
        await storage.outboxRemove(hlcs);
      });
      if (removedAny) {
        emitter.emit({ kind: "outbox", depth: outboxMap.size });
      }
    }
  }

  function handleMessage(msg: ServerMessage): void {
    if (stopped) return;
    switch (msg.type) {
      case "SYNC_BROADCAST":
        handleSyncBroadcast(msg);
        break;
      case "SNAPSHOT_REQUIRED":
        handleSnapshotRequired(msg.oldestAvailableSeq);
        break;
      case "ERROR":
        handleError(msg);
        break;
      case "PRESENCE":
        // Ephemeral presence is handled separately (T32).
        break;
    }
  }

  function handleStatus(next: ConnStatus): void {
    if (stopped) return;
    connStatus = next;
    emitter.emit({ kind: "status", status: next });

    if (next === "online") {
      pullInFlight = false;
      bufferedBroadcasts.clear();
      if (!snapshotInFlight) {
        // Protocol §5.5: SYNC_PULL first, then flush outbox.
        transport.send({ type: "SYNC_PULL", lastSyncedSeq });
        scheduleFlush();
      }
    } else {
      clearFlushTimer();
    }
  }

  return {
    async start(): Promise<void> {
      if (started) return;
      started = true;
      stopped = false;

      const { state, outbox, meta } = await storage.load();
      lastSyncedSeq = meta.lastSyncedSeq;

      const touched = new Set<string>();
      for (const [objectId, fields] of Object.entries(state)) {
        for (const [field, reg] of Object.entries(fields)) {
          map.apply({ objectId, field, value: reg.value, hlc: reg.hlc });
          touched.add(objectId);
        }
      }

      if (meta.lastHlc !== null && compareHlc(meta.lastHlc, clock.last()) > 0) {
        try {
          clock.receive(meta.lastHlc);
        } catch {
          // Ignore skew if persisted HLC is ahead of local wall clock.
        }
      }

      for (const op of outbox) {
        const key = outboxKey(op.objectId, op.field);
        const existing = outboxMap.get(key);
        if (existing === undefined || compareHlc(op.hlc, existing.hlc) > 0) {
          outboxMap.set(key, op);
        }
      }

      lastVisibleIds = map.visibleObjectIds();
      if (touched.size > 0) {
        for (const objectId of touched) {
          const subs = objectSubscribers.get(objectId);
          if (subs !== undefined) {
            for (const cb of subs) cb();
          }
        }
        for (const cb of idSubscribers) cb();
      }

      if (outboxMap.size > 0) {
        emitter.emit({ kind: "outbox", depth: outboxMap.size });
      }

      unsubMessage = transport.onMessage(handleMessage);
      unsubStatus = transport.onStatus(handleStatus);
      transport.connect();
    },

    async stop(): Promise<void> {
      if (stopped) return;
      stopped = true;
      clearFlushTimer();
      unsubMessage?.();
      unsubStatus?.();
      unsubMessage = null;
      unsubStatus = null;
      transport.close();
      await persistChain;
    },

    mutate(changes: Array<Omit<Op, "hlc">>): Op[] {
      if (changes.length === 0) return [];

      const ops: Op[] = [];
      const touchedObjects = new Set<string>();

      for (const change of changes) {
        const hlc = clock.tick();
        const op: Op = {
          objectId: change.objectId,
          field: change.field,
          value: change.value,
          hlc,
        };
        map.apply(op);
        ops.push(op);
        touchedObjects.add(op.objectId);

        const key = outboxKey(op.objectId, op.field);
        const existing = outboxMap.get(key);
        if (existing === undefined || compareHlc(op.hlc, existing.hlc) > 0) {
          outboxMap.set(key, op);
        }
      }

      const lastHlcSnapshot = clock.last();
      enqueuePersist(async () => {
        await storage.putRegisters(ops);
        await storage.outboxPut(ops);
        await storage.setMeta({ nodeId, lastHlc: lastHlcSnapshot });
      });

      notifySubscribers(touchedObjects);

      for (const op of ops) {
        emitter.emit({ kind: "local_op", op });
      }
      emitter.emit({ kind: "outbox", depth: outboxMap.size });

      scheduleFlush();
      return ops;
    },

    map,

    get status(): ConnStatus {
      return connStatus;
    },

    subscribeObject(objectId: string, cb: () => void): () => void {
      let subs = objectSubscribers.get(objectId);
      if (subs === undefined) {
        subs = new Set();
        objectSubscribers.set(objectId, subs);
      }
      subs.add(cb);
      return () => {
        subs?.delete(cb);
        if (subs?.size === 0) {
          objectSubscribers.delete(objectId);
        }
      };
    },

    subscribeIds(cb: () => void): () => void {
      idSubscribers.add(cb);
      return () => {
        idSubscribers.delete(cb);
      };
    },

    on(cb: (e: SyncEvent) => void): () => void {
      return emitter.on(cb);
    },

    transport,
  };
}
