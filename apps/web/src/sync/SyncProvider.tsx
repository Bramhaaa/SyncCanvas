"use client";

import {
  createHlcClock,
  createIndexedDbStorage,
  createSyncClient,
  createWebSocketTransport,
  type ConnStatus,
  type FieldValue,
  type SyncClient,
  type SyncEvent,
} from "@synccanvas/sync-engine";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { createSyncStore, type SyncStore } from "./sync-store";

const SyncStoreContext = createContext<SyncStore | null>(null);

function generateNodeId(paneId: string): string {
  const cleanPane =
    paneId
      .toLowerCase()
      .replace(/[^a-z0-9_]/g, "")
      .slice(0, 8) || "p";
  const rand = Math.random().toString(36).slice(2, 10);
  return `u_${cleanPane}_${rand}`.slice(0, 32);
}

function getOrCreateNodeId(boardId: string, paneId: string): string {
  if (typeof window === "undefined") {
    return generateNodeId(paneId);
  }
  const storageKey = `synccanvas_node_${boardId}_${paneId}`;
  try {
    const existing = window.localStorage.getItem(storageKey);
    if (existing && /^[a-z0-9_]{1,32}$/.test(existing)) {
      return existing;
    }
    const created = generateNodeId(paneId);
    window.localStorage.setItem(storageKey, created);
    return created;
  } catch {
    return generateNodeId(paneId);
  }
}

export interface SyncProviderProps {
  boardId: string;
  paneId: string;
  nodeId?: string;
  wsBaseUrl?: string;
  apiBaseUrl?: string;
  /** Optional pre-built SyncClient (used in tests and loopback/local-only mode). */
  client?: SyncClient;
  /** Set to false if the caller manages `client.start()`/`stop()` itself. Defaults to true. */
  autoStart?: boolean;
  children: ReactNode;
}

export function SyncProvider({
  boardId,
  paneId,
  nodeId: explicitNodeId,
  wsBaseUrl,
  apiBaseUrl,
  client: injectedClient,
  autoStart = true,
  children,
}: SyncProviderProps) {
  const resolvedNodeId = useMemo(
    () => explicitNodeId ?? getOrCreateNodeId(boardId, paneId),
    [explicitNodeId, boardId, paneId],
  );

  const bundle = useMemo(() => {
    const ownsClient = injectedClient === undefined;
    const client =
      injectedClient ??
      (() => {
        const wsBase = (
          wsBaseUrl ??
          process.env.NEXT_PUBLIC_WS_URL ??
          "ws://localhost:8080"
        ).replace(/\/$/, "");
        const apiBase = (
          apiBaseUrl ??
          process.env.NEXT_PUBLIC_API_URL ??
          "http://localhost:8080"
        ).replace(/\/$/, "");

        const storage = createIndexedDbStorage({
          boardId,
          paneId,
          nodeId: resolvedNodeId,
        });
        const clock = createHlcClock({
          nodeId: resolvedNodeId,
          now: () => Date.now(),
        });
        const transport = createWebSocketTransport(
          `${wsBase}/ws/boards/${encodeURIComponent(boardId)}?clientId=${encodeURIComponent(resolvedNodeId)}`,
        );

        return createSyncClient({
          boardId,
          nodeId: resolvedNodeId,
          storage,
          transport,
          clock,
          apiBaseUrl: apiBase,
        });
      })();

    const store = createSyncStore(client, {
      boardId,
      paneId,
      nodeId: resolvedNodeId,
    });

    return { client, store, ownsClient };
  }, [injectedClient, boardId, paneId, resolvedNodeId, wsBaseUrl, apiBaseUrl]);

  useEffect(() => {
    const { client, store, ownsClient } = bundle;
    if (autoStart) {
      void client.start();
    }
    return () => {
      store.dispose();
      if (autoStart && ownsClient) {
        void client.stop();
      }
    };
  }, [bundle, autoStart]);

  return <SyncStoreContext.Provider value={bundle.store}>{children}</SyncStoreContext.Provider>;
}

function useSyncStore(): SyncStore {
  const store = useContext(SyncStoreContext);
  if (store === null) {
    throw new Error("Sync hooks must be used inside a <SyncProvider>");
  }
  return store;
}

export function useSyncClient(): SyncClient {
  return useSyncStore().client;
}

export function useSyncMeta(): { boardId: string; paneId: string; nodeId: string } {
  const store = useSyncStore();
  return { boardId: store.boardId, paneId: store.paneId, nodeId: store.nodeId };
}

export function useObject(objectId: string): Record<string, FieldValue> | undefined {
  const store = useSyncStore();
  const subscribe = useCallback(
    (cb: () => void) => store.subscribeObject(objectId, cb),
    [store, objectId],
  );
  const getSnapshot = useCallback(() => store.getObjectSnapshot(objectId), [store, objectId]);
  return useSyncExternalStore(subscribe, getSnapshot, () => undefined);
}

const EMPTY_IDS: string[] = [];

export function useVisibleIds(): string[] {
  const store = useSyncStore();
  return useSyncExternalStore(store.subscribeIds, store.getVisibleIdsSnapshot, () => EMPTY_IDS);
}

const EMPTY_EVENTS: SyncEvent[] = [];

export function useSyncEvents(): SyncEvent[] {
  const store = useSyncStore();
  return useSyncExternalStore(store.subscribeEvents, store.getEventsSnapshot, () => EMPTY_EVENTS);
}

export function useConnStatus(): ConnStatus {
  const store = useSyncStore();
  return useSyncExternalStore(store.subscribeStatus, store.getStatusSnapshot, () => "offline");
}

export function useOutboxDepth(): number {
  const store = useSyncStore();
  return useSyncExternalStore(store.subscribeOutbox, store.getOutboxSnapshot, () => 0);
}
