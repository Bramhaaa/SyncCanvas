import { createLwwMap } from "../lww-map.js";
import type {
  ClientMessage,
  ServerMessage,
  SnapshotResponse,
  SyncBroadcastMessage,
} from "../protocol.js";
import type { ConnStatus, LwwMap, Op, Transport } from "../types.js";

const CATCHUP_PAGE_LIMIT = 500;

interface ConnectedClient {
  clientId: string;
  deliver: (msg: ServerMessage) => void;
}

export interface FakeServer {
  readonly map: LwwMap;
  latestSeq(): number;
  oldestAvailableSeq(): number;
  getSnapshot(): SnapshotResponse;
  /** Prune op log up to `upToSeq` (defaults to latestSeq) to trigger SNAPSHOT_REQUIRED. */
  compact(upToSeq?: number): void;
  /** Drop the next `count` live SYNC_BROADCAST frames for `clientId` (for gap-detection tests). */
  dropNextBroadcastFor(clientId: string, count?: number): void;
  createTransport(clientId: string): Transport;
}

class OrderedDelayQueue {
  private timers = new Set<ReturnType<typeof setTimeout>>();
  private lastScheduledAt = 0;

  enqueue(delayMs: number, fn: () => void): void {
    if (delayMs <= 0 && this.timers.size === 0) {
      fn();
      return;
    }

    const now = Date.now();
    const target = Math.max(now + Math.max(0, delayMs), this.lastScheduledAt);
    this.lastScheduledAt = target;
    const wait = Math.max(0, target - now);

    const timer = setTimeout(() => {
      this.timers.delete(timer);
      fn();
    }, wait);
    this.timers.add(timer);
  }

  clear(): void {
    for (const timer of this.timers) {
      clearTimeout(timer);
    }
    this.timers.clear();
    this.lastScheduledAt = 0;
  }
}

export function createFakeServer(): FakeServer {
  const map = createLwwMap();
  const opLog: Array<{ serverSeq: number; op: Op }> = [];
  const seenOps = new Set<string>();
  const clients = new Map<string, ConnectedClient>();
  const dropCounters = new Map<string, number>();

  let nextSeq = 0;
  let oldestSeq = 1;

  function dedupKey(op: Op): string {
    return `${op.objectId}\0${op.field}\0${op.hlc}`;
  }

  function handleClientMessage(clientId: string, msg: ClientMessage): void {
    if (msg.type === "SYNC_PUSH") {
      const storedOps: Op[] = [];
      for (const op of msg.ops) {
        const key = dedupKey(op);
        if (seenOps.has(key)) continue;
        seenOps.add(key);
        nextSeq += 1;
        const cloned = structuredClone(op);
        opLog.push({ serverSeq: nextSeq, op: cloned });
        map.apply(cloned);
        storedOps.push(cloned);
      }

      if (storedOps.length === 0) return;

      const serverSeqEnd = nextSeq;
      const serverSeqStart = serverSeqEnd - storedOps.length + 1;
      const broadcast: SyncBroadcastMessage = {
        type: "SYNC_BROADCAST",
        serverSeqStart,
        serverSeqEnd,
        originClientId: clientId,
        ops: storedOps,
      };

      for (const client of clients.values()) {
        const remainingDrops = dropCounters.get(client.clientId) ?? 0;
        if (remainingDrops > 0) {
          if (remainingDrops === 1) {
            dropCounters.delete(client.clientId);
          } else {
            dropCounters.set(client.clientId, remainingDrops - 1);
          }
          continue;
        }
        client.deliver(structuredClone(broadcast));
      }
      return;
    }

    if (msg.type === "SYNC_PULL") {
      const requester = clients.get(clientId);
      if (!requester) return;

      if (msg.lastSyncedSeq < oldestSeq - 1) {
        requester.deliver({
          type: "SNAPSHOT_REQUIRED",
          oldestAvailableSeq: oldestSeq,
        });
        return;
      }

      const missing = opLog.filter((entry) => entry.serverSeq > msg.lastSyncedSeq);
      for (let i = 0; i < missing.length; i += CATCHUP_PAGE_LIMIT) {
        const page = missing.slice(i, i + CATCHUP_PAGE_LIMIT);
        const first = page[0]!;
        const last = page[page.length - 1]!;
        requester.deliver({
          type: "SYNC_BROADCAST",
          serverSeqStart: first.serverSeq,
          serverSeqEnd: last.serverSeq,
          originClientId: "server",
          ops: page.map((e) => structuredClone(e.op)),
        });
      }
      return;
    }

    if (msg.type === "PRESENCE") {
      for (const client of clients.values()) {
        if (client.clientId === clientId) continue;
        client.deliver(structuredClone(msg));
      }
    }
  }

  return {
    map,

    latestSeq(): number {
      return nextSeq;
    },

    oldestAvailableSeq(): number {
      return oldestSeq;
    },

    getSnapshot(): SnapshotResponse {
      return {
        state: structuredClone(map.toJSON()),
        snapshotSeq: nextSeq,
      };
    },

    compact(upToSeq: number = nextSeq): void {
      const cutoff = Math.min(upToSeq, nextSeq);
      let firstKept = 0;
      while (firstKept < opLog.length && opLog[firstKept]!.serverSeq <= cutoff) {
        firstKept += 1;
      }
      if (firstKept > 0) {
        opLog.splice(0, firstKept);
      }
      oldestSeq = opLog.length > 0 ? opLog[0]!.serverSeq : nextSeq + 1;
    },

    dropNextBroadcastFor(clientId: string, count = 1): void {
      if (count <= 0) return;
      dropCounters.set(clientId, (dropCounters.get(clientId) ?? 0) + count);
    },

    createTransport(clientId: string): Transport {
      const messageListeners = new Set<(msg: ServerMessage) => void>();
      const statusListeners = new Set<(s: ConnStatus) => void>();
      const outboundQueue = new OrderedDelayQueue();
      const inboundQueue = new OrderedDelayQueue();

      let status: ConnStatus = "offline";
      let shouldConnect = false;
      let onlineEnabled = true;
      let latencyMs = 0;

      function setStatus(next: ConnStatus): void {
        if (status === next) return;
        status = next;
        for (const cb of statusListeners) {
          cb(next);
        }
      }

      function register(): void {
        if (!shouldConnect || !onlineEnabled) return;
        clients.set(clientId, {
          clientId,
          deliver(msg: ServerMessage) {
            if (!onlineEnabled || status !== "online") return;
            inboundQueue.enqueue(latencyMs, () => {
              if (!onlineEnabled || status !== "online") return;
              for (const cb of messageListeners) {
                cb(msg);
              }
            });
          },
        });
        setStatus("online");
      }

      function unregister(): void {
        clients.delete(clientId);
        outboundQueue.clear();
        inboundQueue.clear();
        setStatus("offline");
      }

      return {
        connect(): void {
          shouldConnect = true;
          if (onlineEnabled) {
            register();
          }
        },

        close(): void {
          shouldConnect = false;
          unregister();
        },

        send(msg: ClientMessage): void {
          if (!onlineEnabled || status !== "online") return;
          const cloned = structuredClone(msg);
          outboundQueue.enqueue(latencyMs, () => {
            if (!onlineEnabled || status !== "online") return;
            handleClientMessage(clientId, cloned);
          });
        },

        onMessage(cb: (msg: ServerMessage) => void): () => void {
          messageListeners.add(cb);
          return () => {
            messageListeners.delete(cb);
          };
        },

        onStatus(cb: (s: ConnStatus) => void): () => void {
          statusListeners.add(cb);
          return () => {
            statusListeners.delete(cb);
          };
        },

        setOnline(online: boolean): void {
          if (onlineEnabled === online) return;
          onlineEnabled = online;
          if (!online) {
            unregister();
          } else if (shouldConnect) {
            register();
          }
        },

        setLatency(ms: number): void {
          latencyMs = Math.max(0, ms);
        },
      };
    },
  };
}
