import type { CursorPosition, PresenceMessage, ServerMessage } from "./protocol.js";
import type { Transport } from "./types.js";

const PEER_COLORS = [
  "#ef4444",
  "#f97316",
  "#eab308",
  "#22c55e",
  "#14b8a6",
  "#06b6d4",
  "#3b82f6",
  "#6366f1",
  "#a855f7",
  "#ec4899",
] as const;

export function colorFromNodeId(nodeId: string): string {
  let hash = 2166136261;
  for (let i = 0; i < nodeId.length; i++) {
    hash ^= nodeId.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return PEER_COLORS[(hash >>> 0) % PEER_COLORS.length]!;
}

export interface RemotePeer {
  clientId: string;
  displayName: string;
  color: string;
  cursor: CursorPosition | null;
  selectedIds: string[];
  lastSeenAt: number;
}

export interface PresenceUpdate {
  cursor?: CursorPosition | null;
  selectedIds?: string[];
}

export interface PresenceClientOptions {
  transport: Transport;
  clientId: string;
  displayName: string;
  color?: string;
  throttleMs?: number;
  staleTimeoutMs?: number;
  now?: () => number;
}

export interface PresenceClient {
  start(): void;
  stop(): void;
  update(patch: PresenceUpdate): void;
  leave(): void;
  getPeers(): RemotePeer[];
  subscribe(cb: () => void): () => void;
}

function sameCursor(a: CursorPosition | null, b: CursorPosition | null): boolean {
  if (a === b) return true;
  if (a === null || b === null) return false;
  return a.x === b.x && a.y === b.y;
}

function sameIds(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

export function createPresenceClient(options: PresenceClientOptions): PresenceClient {
  const {
    transport,
    clientId,
    displayName,
    color = colorFromNodeId(clientId),
    throttleMs = 50,
    staleTimeoutMs = 5_000,
    now = () => Date.now(),
  } = options;

  const peers = new Map<string, RemotePeer>();
  const listeners = new Set<() => void>();

  let cachedPeers: RemotePeer[] = [];
  let unsubMessage: (() => void) | null = null;
  let sweepTimer: ReturnType<typeof setInterval> | null = null;
  let throttleTimer: ReturnType<typeof setTimeout> | null = null;

  let lastSentAt = -Infinity;
  let lastSentCursor: CursorPosition | null = null;
  let lastSentSelected: string[] = [];
  let hasSentOnce = false;

  let pendingCursor: CursorPosition | null = null;
  let pendingSelected: string[] = [];

  function notify(): void {
    cachedPeers = Array.from(peers.values());
    for (const cb of listeners) {
      cb();
    }
  }

  function sendNow(): void {
    if (
      hasSentOnce &&
      sameCursor(pendingCursor, lastSentCursor) &&
      sameIds(pendingSelected, lastSentSelected)
    ) {
      return;
    }

    hasSentOnce = true;
    lastSentAt = now();
    lastSentCursor = pendingCursor ? { x: pendingCursor.x, y: pendingCursor.y } : null;
    lastSentSelected = [...pendingSelected];

    const msg: PresenceMessage = {
      type: "PRESENCE",
      clientId,
      displayName,
      color,
      cursor: lastSentCursor,
      selectedIds: lastSentSelected,
    };
    transport.send(msg);
  }

  function handleMessage(msg: ServerMessage): void {
    if (msg.type !== "PRESENCE") return;
    if (msg.clientId === clientId) return;

    if (msg.cursor === null && msg.selectedIds.length === 0) {
      if (peers.delete(msg.clientId)) {
        notify();
      }
      return;
    }

    peers.set(msg.clientId, {
      clientId: msg.clientId,
      displayName: msg.displayName,
      color: msg.color,
      cursor: msg.cursor,
      selectedIds: [...msg.selectedIds],
      lastSeenAt: now(),
    });
    notify();
  }

  function sweepStalePeers(): void {
    const cutoff = now() - staleTimeoutMs;
    let removed = false;
    for (const [id, peer] of peers) {
      if (peer.lastSeenAt < cutoff) {
        peers.delete(id);
        removed = true;
      }
    }
    if (removed) {
      notify();
    }
  }

  return {
    start(): void {
      if (unsubMessage !== null) return;
      unsubMessage = transport.onMessage(handleMessage);
      sweepTimer = setInterval(sweepStalePeers, Math.min(1_000, Math.max(200, staleTimeoutMs / 5)));
    },

    stop(): void {
      if (throttleTimer !== null) {
        clearTimeout(throttleTimer);
        throttleTimer = null;
      }
      if (sweepTimer !== null) {
        clearInterval(sweepTimer);
        sweepTimer = null;
      }
      unsubMessage?.();
      unsubMessage = null;
      peers.clear();
      notify();
    },

    update(patch: PresenceUpdate): void {
      if (patch.cursor !== undefined) {
        pendingCursor = patch.cursor;
      }
      if (patch.selectedIds !== undefined) {
        pendingSelected = [...patch.selectedIds];
      }

      if (
        hasSentOnce &&
        sameCursor(pendingCursor, lastSentCursor) &&
        sameIds(pendingSelected, lastSentSelected)
      ) {
        return;
      }

      const elapsed = now() - lastSentAt;
      if (elapsed >= throttleMs) {
        if (throttleTimer !== null) {
          clearTimeout(throttleTimer);
          throttleTimer = null;
        }
        sendNow();
      } else if (throttleTimer === null) {
        throttleTimer = setTimeout(() => {
          throttleTimer = null;
          sendNow();
        }, throttleMs - elapsed);
      }
    },

    leave(): void {
      if (throttleTimer !== null) {
        clearTimeout(throttleTimer);
        throttleTimer = null;
      }
      pendingCursor = null;
      pendingSelected = [];
      sendNow();
    },

    getPeers(): RemotePeer[] {
      return cachedPeers;
    },

    subscribe(cb: () => void): () => void {
      listeners.add(cb);
      return () => {
        listeners.delete(cb);
      };
    },
  };
}
