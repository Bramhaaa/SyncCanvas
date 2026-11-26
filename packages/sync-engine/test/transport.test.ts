import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ClientMessage, ServerMessage } from "../src/protocol.js";
import { createFakeServer } from "../src/transport/loopback.js";
import { createWebSocketTransport, type WebSocketLike } from "../src/transport/websocket.js";
import type { ConnStatus } from "../src/types.js";

class MockWebSocket implements WebSocketLike {
  static instances: MockWebSocket[] = [];
  readyState = 0; // CONNECTING
  sent: string[] = [];
  closed = false;

  onopen: ((event: unknown) => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onclose: ((event: unknown) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;

  constructor(public readonly url: string) {
    MockWebSocket.instances.push(this);
  }

  send(data: string): void {
    this.sent.push(data);
  }

  close(): void {
    this.closed = true;
    this.readyState = 3; // CLOSED
  }

  simulateOpen(): void {
    this.readyState = 1; // OPEN
    this.onopen?.({});
  }

  simulateMessage(msg: ServerMessage): void {
    this.onmessage?.({ data: JSON.stringify(msg) });
  }

  simulateClose(): void {
    this.readyState = 3;
    this.onclose?.({});
  }
}

describe("WebSocketTransport", () => {
  beforeEach(() => {
    MockWebSocket.instances = [];
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("reconnects with exponential backoff and full jitter, resetting on open", () => {
    const statuses: ConnStatus[] = [];
    // random() returns 0.5 -> delays: 125ms, 250ms, 500ms, ...
    const transport = createWebSocketTransport("ws://localhost:8080/ws/boards/brd_1?clientId=a", {
      baseBackoffMs: 250,
      maxBackoffMs: 1_000,
      random: () => 0.5,
      WebSocketImpl: MockWebSocket,
    });
    transport.onStatus((s) => statuses.push(s));

    transport.connect();
    expect(MockWebSocket.instances).toHaveLength(1);
    expect(statuses).toEqual(["connecting"]);

    // Drop #1 -> delay = floor(0.5 * 250) = 125ms
    MockWebSocket.instances[0]!.simulateClose();
    expect(statuses).toEqual(["connecting", "offline"]);

    vi.advanceTimersByTime(124);
    expect(MockWebSocket.instances).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(MockWebSocket.instances).toHaveLength(2);

    // Drop #2 -> delay = floor(0.5 * 500) = 250ms
    MockWebSocket.instances[1]!.simulateClose();
    vi.advanceTimersByTime(249);
    expect(MockWebSocket.instances).toHaveLength(2);
    vi.advanceTimersByTime(1);
    expect(MockWebSocket.instances).toHaveLength(3);

    // Open succeeds -> backoff resets
    MockWebSocket.instances[2]!.simulateOpen();
    expect(statuses[statuses.length - 1]).toBe("online");

    // Next drop should use base backoff again (125ms)
    MockWebSocket.instances[2]!.simulateClose();
    vi.advanceTimersByTime(125);
    expect(MockWebSocket.instances).toHaveLength(4);

    transport.close();
  });

  it("stops reconnecting and drops sends when setOnline(false), then reconnects on setOnline(true)", () => {
    const statuses: ConnStatus[] = [];
    const transport = createWebSocketTransport("ws://localhost/ws", {
      random: () => 0.5,
      WebSocketImpl: MockWebSocket,
    });
    transport.onStatus((s) => statuses.push(s));

    transport.connect();
    const ws1 = MockWebSocket.instances[0]!;
    ws1.simulateOpen();
    expect(statuses).toEqual(["connecting", "online"]);

    transport.setOnline(false);
    expect(ws1.closed).toBe(true);
    expect(statuses).toEqual(["connecting", "online", "offline"]);

    // Sends while offline are no-ops
    const pull: ClientMessage = { type: "SYNC_PULL", lastSyncedSeq: 0 };
    transport.send(pull);
    expect(ws1.sent).toHaveLength(0);

    // Advance well past max backoff: must not reconnect while offline
    vi.advanceTimersByTime(60_000);
    expect(MockWebSocket.instances).toHaveLength(1);

    // Toggle back online -> reconnects immediately
    transport.setOnline(true);
    expect(MockWebSocket.instances).toHaveLength(2);
    MockWebSocket.instances[1]!.simulateOpen();
    expect(statuses[statuses.length - 1]).toBe("online");

    transport.close();
  });

  it("delays both directions while preserving FIFO order under latency", () => {
    const received: ServerMessage[] = [];
    const transport = createWebSocketTransport("ws://localhost/ws", {
      WebSocketImpl: MockWebSocket,
    });
    transport.onMessage((m) => received.push(m));
    transport.setLatency(200);

    transport.connect();
    const ws = MockWebSocket.instances[0]!;
    ws.simulateOpen();

    // Outbound ordering even if latency shrinks between sends
    transport.send({ type: "SYNC_PULL", lastSyncedSeq: 1 });
    transport.setLatency(50);
    transport.send({ type: "SYNC_PULL", lastSyncedSeq: 2 });

    expect(ws.sent).toHaveLength(0);
    vi.advanceTimersByTime(200);
    expect(ws.sent.map((s) => (JSON.parse(s) as { lastSyncedSeq: number }).lastSyncedSeq)).toEqual([
      1, 2,
    ]);

    // Inbound ordering
    transport.setLatency(150);
    ws.simulateMessage({ type: "SNAPSHOT_REQUIRED", oldestAvailableSeq: 10 });
    transport.setLatency(10);
    ws.simulateMessage({ type: "SNAPSHOT_REQUIRED", oldestAvailableSeq: 20 });

    expect(received).toHaveLength(0);
    vi.advanceTimersByTime(150);
    expect(
      received.map((m) => (m.type === "SNAPSHOT_REQUIRED" ? m.oldestAvailableSeq : -1)),
    ).toEqual([10, 20]);

    transport.close();
  });
});

describe("LoopbackTransport + FakeServer", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("broadcasts sequenced ops to all clients including origin and deduplicates resends", () => {
    const server = createFakeServer();
    const tA = server.createTransport("user_a");
    const tB = server.createTransport("user_b");

    const msgsA: ServerMessage[] = [];
    const msgsB: ServerMessage[] = [];
    tA.onMessage((m) => msgsA.push(m));
    tB.onMessage((m) => msgsB.push(m));

    tA.connect();
    tB.connect();

    const op = {
      objectId: "obj_1",
      field: "x",
      value: 42,
      hlc: "0000000001000:00000:user_a",
    };

    tA.send({ type: "SYNC_PUSH", clientId: "user_a", ops: [op] });
    expect(msgsA).toHaveLength(1);
    expect(msgsB).toHaveLength(1);
    expect(msgsA[0]).toMatchObject({
      type: "SYNC_BROADCAST",
      serverSeqStart: 1,
      serverSeqEnd: 1,
      originClientId: "user_a",
    });

    // Duplicate push is a no-op
    tA.send({ type: "SYNC_PUSH", clientId: "user_a", ops: [op] });
    expect(msgsA).toHaveLength(1);
    expect(server.latestSeq()).toBe(1);
  });

  it("supports SYNC_PULL catch-up, SNAPSHOT_REQUIRED after compaction, and latency", () => {
    const server = createFakeServer();
    const tA = server.createTransport("user_a");
    const tB = server.createTransport("user_b");

    const msgsB: ServerMessage[] = [];
    tB.onMessage((m) => msgsB.push(m));
    tB.setLatency(100);

    tA.connect();
    tB.connect();
    tB.setOnline(false);

    tA.send({
      type: "SYNC_PUSH",
      clientId: "user_a",
      ops: [
        { objectId: "obj_1", field: "type", value: "rect", hlc: "0000000001000:00000:user_a" },
        { objectId: "obj_1", field: "x", value: 10, hlc: "0000000001000:00001:user_a" },
      ],
    });

    // B reconnects and pulls from seq 0
    tB.setOnline(true);
    tB.send({ type: "SYNC_PULL", lastSyncedSeq: 0 });
    expect(msgsB).toHaveLength(0);
    vi.advanceTimersByTime(200); // 100ms outbound + 100ms inbound
    expect(msgsB).toHaveLength(1);
    expect(msgsB[0]).toMatchObject({
      type: "SYNC_BROADCAST",
      serverSeqStart: 1,
      serverSeqEnd: 2,
      originClientId: "server",
    });

    // Compact server log and pull from 0 -> SNAPSHOT_REQUIRED
    server.compact(2);
    tB.setLatency(0);
    tB.send({ type: "SYNC_PULL", lastSyncedSeq: 0 });
    expect(msgsB[1]).toEqual({
      type: "SNAPSHOT_REQUIRED",
      oldestAvailableSeq: 3,
    });
  });
});
