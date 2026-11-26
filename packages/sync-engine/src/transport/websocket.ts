import type { ClientMessage, ServerMessage } from "../protocol.js";
import type { ConnStatus, Transport } from "../types.js";

/** Minimal WebSocket shape compatible with both browser WebSocket and Node `ws`. */
export interface WebSocketLike {
  readonly readyState: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  onopen: ((event: unknown) => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  onclose: ((event: unknown) => void) | null;
  onerror: ((event: unknown) => void) | null;
}

export type WebSocketConstructor = new (url: string) => WebSocketLike;

export interface WebSocketTransportOptions {
  baseBackoffMs?: number;
  maxBackoffMs?: number;
  random?: () => number;
  WebSocketImpl?: WebSocketConstructor;
}

const WS_OPEN = 1;
const DEFAULT_BASE_BACKOFF_MS = 250;
const DEFAULT_MAX_BACKOFF_MS = 10_000;

/**
 * Schedules callbacks with a configurable delay while preserving strict FIFO order
 * even if the delay changes between calls.
 */
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

export function createWebSocketTransport(
  url: string,
  options: WebSocketTransportOptions = {},
): Transport {
  const {
    baseBackoffMs = DEFAULT_BASE_BACKOFF_MS,
    maxBackoffMs = DEFAULT_MAX_BACKOFF_MS,
    random = Math.random,
    WebSocketImpl,
  } = options;

  const messageListeners = new Set<(msg: ServerMessage) => void>();
  const statusListeners = new Set<(status: ConnStatus) => void>();
  const outboundQueue = new OrderedDelayQueue();
  const inboundQueue = new OrderedDelayQueue();

  let socket: WebSocketLike | null = null;
  let status: ConnStatus = "offline";
  let shouldConnect = false;
  let onlineEnabled = true;
  let latencyMs = 0;
  let reconnectAttempt = 0;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  function setStatus(next: ConnStatus): void {
    if (status === next) return;
    status = next;
    for (const cb of statusListeners) {
      cb(next);
    }
  }

  function clearReconnectTimer(): void {
    if (reconnectTimer !== null) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
  }

  function detachSocket(ws: WebSocketLike): void {
    ws.onopen = null;
    ws.onmessage = null;
    ws.onclose = null;
    ws.onerror = null;
  }

  function tearDownSocket(): void {
    outboundQueue.clear();
    inboundQueue.clear();
    if (socket !== null) {
      const ws = socket;
      socket = null;
      detachSocket(ws);
      try {
        ws.close();
      } catch {
        // Ignore close errors on already-closed sockets.
      }
    }
  }

  function scheduleReconnect(): void {
    if (!shouldConnect || !onlineEnabled || reconnectTimer !== null) return;
    const cap = Math.min(maxBackoffMs, baseBackoffMs * 2 ** reconnectAttempt);
    const delay = Math.floor(random() * cap);
    reconnectAttempt += 1;

    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      openSocket();
    }, delay);
  }

  function openSocket(): void {
    if (!shouldConnect || !onlineEnabled) return;
    clearReconnectTimer();
    tearDownSocket();

    const Ctor =
      WebSocketImpl ??
      (globalThis as unknown as { WebSocket?: WebSocketConstructor }).WebSocket ??
      undefined;
    if (Ctor === undefined) {
      throw new Error("No WebSocket implementation available in this environment");
    }

    setStatus("connecting");
    const ws = new Ctor(url);
    socket = ws;

    ws.onopen = () => {
      if (socket !== ws || !onlineEnabled || !shouldConnect) return;
      reconnectAttempt = 0;
      setStatus("online");
    };

    ws.onmessage = (event) => {
      if (socket !== ws || !onlineEnabled || !shouldConnect) return;
      const raw = typeof event.data === "string" ? event.data : String(event.data);
      let parsed: ServerMessage;
      try {
        parsed = JSON.parse(raw) as ServerMessage;
      } catch {
        return;
      }

      inboundQueue.enqueue(latencyMs, () => {
        if (socket !== ws || !onlineEnabled || !shouldConnect) return;
        for (const cb of messageListeners) {
          cb(parsed);
        }
      });
    };

    ws.onerror = () => {
      // Browsers/Node fire onclose immediately after onerror; let onclose handle reconnect.
    };

    ws.onclose = () => {
      if (socket !== ws) return;
      socket = null;
      detachSocket(ws);
      outboundQueue.clear();
      inboundQueue.clear();
      setStatus("offline");
      if (shouldConnect && onlineEnabled) {
        scheduleReconnect();
      }
    };
  }

  return {
    connect(): void {
      shouldConnect = true;
      if (onlineEnabled && socket === null) {
        reconnectAttempt = 0;
        openSocket();
      }
    },

    close(): void {
      shouldConnect = false;
      clearReconnectTimer();
      tearDownSocket();
      setStatus("offline");
    },

    send(msg: ClientMessage): void {
      if (!onlineEnabled || status !== "online" || socket === null) {
        return;
      }
      const ws = socket;
      const payload = JSON.stringify(msg);
      outboundQueue.enqueue(latencyMs, () => {
        if (socket !== ws || !onlineEnabled || ws.readyState !== WS_OPEN) return;
        ws.send(payload);
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
        clearReconnectTimer();
        tearDownSocket();
        setStatus("offline");
      } else if (shouldConnect) {
        reconnectAttempt = 0;
        openSocket();
      }
    },

    setLatency(ms: number): void {
      latencyMs = Math.max(0, ms);
    },
  };
}
