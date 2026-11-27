"use client";

import type { ConnStatus, FieldValue, SyncClient, SyncEvent } from "@synccanvas/sync-engine";

const MAX_SYNC_EVENTS = 200;

export interface SyncStore {
  readonly client: SyncClient;
  readonly nodeId: string;
  readonly boardId: string;
  readonly paneId: string;
  subscribeObject: (objectId: string, cb: () => void) => () => void;
  getObjectSnapshot: (objectId: string) => Record<string, FieldValue> | undefined;
  subscribeIds: (cb: () => void) => () => void;
  getVisibleIdsSnapshot: () => string[];
  subscribeEvents: (cb: () => void) => () => void;
  getEventsSnapshot: () => SyncEvent[];
  subscribeStatus: (cb: () => void) => () => void;
  getStatusSnapshot: () => ConnStatus;
  subscribeOutbox: (cb: () => void) => () => void;
  getOutboxSnapshot: () => number;
  dispose: () => void;
}

/**
 * Wraps a SyncClient with referentially stable snapshots for React's
 * `useSyncExternalStore` so editing one object only re-renders subscribers
 * of that specific object.
 */
export function createSyncStore(
  client: SyncClient,
  meta: { boardId: string; paneId: string; nodeId: string },
): SyncStore {
  const objectCache = new Map<string, Record<string, FieldValue> | undefined>();
  let visibleIdsCache: string[] = client.map.visibleObjectIds();
  let eventsCache: SyncEvent[] = [];
  let statusCache: ConnStatus = client.status;
  let outboxDepthCache = 0;

  const eventListeners = new Set<() => void>();
  const statusListeners = new Set<() => void>();
  const outboxListeners = new Set<() => void>();

  const unsubIds = client.subscribeIds(() => {
    visibleIdsCache = client.map.visibleObjectIds();
  });

  const unsubClientEvents = client.on((event) => {
    const nextEvents =
      eventsCache.length >= MAX_SYNC_EVENTS
        ? [...eventsCache.slice(eventsCache.length - MAX_SYNC_EVENTS + 1), event]
        : [...eventsCache, event];
    eventsCache = nextEvents;
    for (const cb of eventListeners) cb();

    if (event.kind === "status" && statusCache !== event.status) {
      statusCache = event.status;
      for (const cb of statusListeners) cb();
    } else if (event.kind === "outbox" && outboxDepthCache !== event.depth) {
      outboxDepthCache = event.depth;
      for (const cb of outboxListeners) cb();
    }
  });

  return {
    client,
    nodeId: meta.nodeId,
    boardId: meta.boardId,
    paneId: meta.paneId,

    subscribeObject(objectId: string, cb: () => void): () => void {
      return client.subscribeObject(objectId, () => {
        objectCache.set(objectId, client.map.getObject(objectId));
        cb();
      });
    },

    getObjectSnapshot(objectId: string): Record<string, FieldValue> | undefined {
      if (!objectCache.has(objectId)) {
        objectCache.set(objectId, client.map.getObject(objectId));
      }
      return objectCache.get(objectId);
    },

    subscribeIds(cb: () => void): () => void {
      return client.subscribeIds(() => {
        visibleIdsCache = client.map.visibleObjectIds();
        cb();
      });
    },

    getVisibleIdsSnapshot(): string[] {
      return visibleIdsCache;
    },

    subscribeEvents(cb: () => void): () => void {
      eventListeners.add(cb);
      return () => {
        eventListeners.delete(cb);
      };
    },

    getEventsSnapshot(): SyncEvent[] {
      return eventsCache;
    },

    subscribeStatus(cb: () => void): () => void {
      statusListeners.add(cb);
      return () => {
        statusListeners.delete(cb);
      };
    },

    getStatusSnapshot(): ConnStatus {
      return statusCache;
    },

    subscribeOutbox(cb: () => void): () => void {
      outboxListeners.add(cb);
      return () => {
        outboxListeners.delete(cb);
      };
    },

    getOutboxSnapshot(): number {
      return outboxDepthCache;
    },

    dispose(): void {
      unsubIds();
      unsubClientEvents();
      eventListeners.clear();
      statusListeners.clear();
      outboxListeners.clear();
      objectCache.clear();
    },
  };
}
