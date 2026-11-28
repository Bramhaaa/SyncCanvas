import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { createHlcClock } from "../src/hlc.js";
import { createMemoryStorage } from "../src/storage/memory.js";
import { createSyncClient } from "../src/sync-client.js";
import { createFakeServer, type FakeServer } from "../src/transport/loopback.js";
import type { Storage, SyncClient, SyncEvent } from "../src/types.js";

function makeClient(
  server: FakeServer,
  nodeId: string,
  options: {
    storage?: Storage;
    now?: () => number;
    flushIntervalMs?: number;
  } = {},
): { client: SyncClient; storage: Storage; events: SyncEvent[] } {
  const storage = options.storage ?? createMemoryStorage({ nodeId });
  const clock = createHlcClock({
    nodeId,
    now: options.now ?? (() => 1_732_579_200_000),
  });
  const transport = server.createTransport(nodeId);
  const events: SyncEvent[] = [];
  const client = createSyncClient({
    boardId: "brd_test0001",
    nodeId,
    storage,
    transport,
    clock,
    flushIntervalMs: options.flushIntervalMs ?? 0,
    fetchSnapshot: async () => server.getSnapshot(),
  });
  client.on((e) => events.push(e));
  return { client, storage, events };
}

async function flushMicrotasks(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe("SyncClient", () => {
  it("syncs mutations between two clients and clears outbox on per-op ack", async () => {
    const server = createFakeServer();
    const a = makeClient(server, "user_a");
    const b = makeClient(server, "user_b");

    await a.client.start();
    await b.client.start();

    const objCalls: string[] = [];
    let idsCalls = 0;
    b.client.subscribeObject("obj_1", () => objCalls.push("obj_1"));
    b.client.subscribeIds(() => {
      idsCalls += 1;
    });

    a.client.mutate([
      { objectId: "obj_1", field: "type", value: "rect" },
      { objectId: "obj_1", field: "x", value: 120 },
      { objectId: "obj_1", field: "zIndex", value: "a0" },
    ]);

    await flushMicrotasks();

    expect(await a.client.map.stateHash()).toBe(await b.client.map.stateHash());
    expect(await a.client.map.stateHash()).toBe(await server.map.stateHash());
    expect(b.client.map.getObject("obj_1")).toMatchObject({ type: "rect", x: 120 });
    expect(objCalls).toEqual(["obj_1"]);
    expect(idsCalls).toBe(1);

    // Outbox cleared via ack
    expect((await a.storage.load()).outbox).toHaveLength(0);
    expect(a.events.some((e) => e.kind === "acked" && e.hlcs.length === 3)).toBe(true);

    await a.client.stop();
    await b.client.stop();
  });

  it("preserves offline edits across a reload (new SyncClient over same MemoryStorage)", async () => {
    const server = createFakeServer();
    const sharedStorage = createMemoryStorage({ nodeId: "user_a" });
    const a1 = makeClient(server, "user_a", { storage: sharedStorage });
    const b = makeClient(server, "user_b");

    await a1.client.start();
    await b.client.start();

    // Go offline and edit
    a1.client.transport.setOnline(false);
    a1.client.mutate([
      { objectId: "obj_off", field: "type", value: "rect" },
      { objectId: "obj_off", field: "x", value: 333 },
    ]);

    // Simulate reload: stop a1 and spin up a2 on the same storage
    await a1.client.stop();
    expect(b.client.map.getObject("obj_off")).toBeUndefined();

    const a2 = makeClient(server, "user_a", { storage: sharedStorage });
    await a2.client.start();
    await flushMicrotasks();

    expect(a2.client.map.getObject("obj_off")).toMatchObject({ type: "rect", x: 333 });
    expect(b.client.map.getObject("obj_off")).toMatchObject({ type: "rect", x: 333 });
    expect(await a2.client.map.stateHash()).toBe(await b.client.map.stateHash());
    expect((await sharedStorage.load()).outbox).toHaveLength(0);

    await a2.client.stop();
    await b.client.stop();
  });

  it("coalesces 600 drag ops while offline down to 2 outbox ops", async () => {
    const server = createFakeServer();
    const a = makeClient(server, "user_a");
    const b = makeClient(server, "user_b");

    await a.client.start();
    await b.client.start();

    a.client.mutate([
      { objectId: "obj_drag", field: "type", value: "rect" },
      { objectId: "obj_drag", field: "x", value: 0 },
      { objectId: "obj_drag", field: "y", value: 0 },
    ]);
    await flushMicrotasks();

    a.client.transport.setOnline(false);
    for (let i = 1; i <= 300; i++) {
      a.client.mutate([
        { objectId: "obj_drag", field: "x", value: i },
        { objectId: "obj_drag", field: "y", value: i * 2 },
      ]);
    }

    await flushMicrotasks();
    const loaded = await a.storage.load();
    expect(loaded.outbox).toHaveLength(2);

    const sentBefore = a.events.filter((e) => e.kind === "sent").length;
    a.client.transport.setOnline(true);
    await flushMicrotasks();

    const sentAfter = a.events.filter((e) => e.kind === "sent").slice(sentBefore);
    expect(sentAfter).toHaveLength(1);
    expect(sentAfter[0]!.kind === "sent" && sentAfter[0]!.ops).toHaveLength(2);
    expect(b.client.map.getObject("obj_drag")).toMatchObject({ x: 300, y: 600 });
    expect(await a.client.map.stateHash()).toBe(await b.client.map.stateHash());

    await a.client.stop();
    await b.client.stop();
  });

  it("detects a dropped broadcast gap, buffers out-of-order frames, and heals via SYNC_PULL", async () => {
    const server = createFakeServer();
    const a = makeClient(server, "user_a");
    const b = makeClient(server, "user_b");

    await a.client.start();
    await b.client.start();

    // Seed seq 1
    a.client.mutate([{ objectId: "obj_1", field: "type", value: "rect" }]);
    // Drop the next broadcast (seq 2) for B
    server.dropNextBroadcastFor("user_b", 1);
    a.client.mutate([{ objectId: "obj_1", field: "x", value: 10 }]);
    // Seq 3 arrives at B -> gap detected (expected 2, got 3) -> B pulls seq 2 & drains buffered seq 3
    a.client.mutate([{ objectId: "obj_1", field: "y", value: 20 }]);

    await flushMicrotasks();

    expect(b.events.some((e) => e.kind === "gap_detected" && e.expected === 2 && e.got === 3)).toBe(
      true,
    );
    expect(b.client.map.getObject("obj_1")).toMatchObject({ type: "rect", x: 10, y: 20 });
    expect(await a.client.map.stateHash()).toBe(await b.client.map.stateHash());

    await a.client.stop();
    await b.client.stop();
  });

  it("recovers from SNAPSHOT_REQUIRED by merging (never replacing) and preserves unsynced local edits", async () => {
    const server = createFakeServer();
    const a = makeClient(server, "user_a");
    const b = makeClient(server, "user_b");

    await a.client.start();
    await b.client.start();

    // B goes offline
    b.client.transport.setOnline(false);

    // A makes edits and server compacts the op log past B's lastSyncedSeq (0)
    a.client.mutate([
      { objectId: "obj_a", field: "type", value: "rect" },
      { objectId: "obj_a", field: "fill", value: "#ff0000" },
    ]);
    server.compact();

    // B makes unsynced offline edits
    b.client.mutate([
      { objectId: "obj_b", field: "type", value: "ellipse" },
      { objectId: "obj_b", field: "x", value: 77 },
    ]);

    // B reconnects -> SYNC_PULL(0) -> SNAPSHOT_REQUIRED -> merges snapshot -> flushes outbox
    b.client.transport.setOnline(true);
    await flushMicrotasks();

    expect(b.events.some((e) => e.kind === "snapshot_required")).toBe(true);
    expect(a.client.map.getObject("obj_a")).toMatchObject({ fill: "#ff0000" });
    expect(a.client.map.getObject("obj_b")).toMatchObject({ type: "ellipse", x: 77 });
    expect(b.client.map.getObject("obj_a")).toMatchObject({ fill: "#ff0000" });
    expect(b.client.map.getObject("obj_b")).toMatchObject({ type: "ellipse", x: 77 });
    expect(await a.client.map.stateHash()).toBe(await b.client.map.stateHash());
    expect(await a.client.map.stateHash()).toBe(await server.map.stateHash());

    await a.client.stop();
    await b.client.stop();
  });

  it("converges 3 clients across random mutations and online/offline toggles (fast-check)", async () => {
    type Action =
      | {
          kind: "mutate";
          clientIdx: number;
          objectIdx: number;
          field: "x" | "y" | "fill";
          val: number;
        }
      | { kind: "toggle"; clientIdx: number; online: boolean };

    const actionArb: fc.Arbitrary<Action> = fc.oneof(
      fc.record({
        kind: fc.constant("mutate" as const),
        clientIdx: fc.integer({ min: 0, max: 2 }),
        objectIdx: fc.integer({ min: 0, max: 3 }),
        field: fc.constantFrom("x" as const, "y" as const, "fill" as const),
        val: fc.integer({ min: 0, max: 1000 }),
      }),
      fc.record({
        kind: fc.constant("toggle" as const),
        clientIdx: fc.integer({ min: 0, max: 2 }),
        online: fc.boolean(),
      }),
    );

    await fc.assert(
      fc.asyncProperty(fc.array(actionArb, { minLength: 10, maxLength: 60 }), async (actions) => {
        const server = createFakeServer();
        let nowMs = 1_732_579_200_000;
        const clients = [
          makeClient(server, "client_0", { now: () => nowMs }),
          makeClient(server, "client_1", { now: () => nowMs + 500 }),
          makeClient(server, "client_2", { now: () => nowMs - 500 }),
        ];

        for (const c of clients) {
          await c.client.start();
        }

        // Seed 4 objects
        for (let i = 0; i < 4; i++) {
          clients[0]!.client.mutate([
            { objectId: `obj_${i}`, field: "type", value: "rect" },
            { objectId: `obj_${i}`, field: "zIndex", value: `a${i}` },
          ]);
        }

        for (const action of actions) {
          nowMs += 10;
          const target = clients[action.clientIdx]!;
          if (action.kind === "toggle") {
            target.client.transport.setOnline(action.online);
          } else {
            const value =
              action.field === "fill" ? `#${action.val.toString(16).padStart(6, "0")}` : action.val;
            target.client.mutate([
              { objectId: `obj_${action.objectIdx}`, field: action.field, value },
            ]);
          }
        }

        // Heal all clients online and let sync settle
        for (const c of clients) {
          c.client.transport.setOnline(true);
        }
        await flushMicrotasks();

        const serverHash = await server.map.stateHash();
        for (const c of clients) {
          expect(await c.client.map.stateHash()).toBe(serverHash);
          expect((await c.storage.load()).outbox).toHaveLength(0);
          await c.client.stop();
        }
      }),
      { numRuns: 25 },
    );
  });

  it("retries outbox with backoff on RATE_LIMITED and stops transport on BOARD_NOT_FOUND", async () => {
    const sent: unknown[] = [];
    let messageHandler: ((m: import("../src/protocol.js").ServerMessage) => void) | null = null;
    let statusHandler: ((s: import("../src/types.js").ConnStatus) => void) | null = null;
    let closed = false;

    const fakeTransport: import("../src/types.js").Transport = {
      connect() {
        statusHandler?.("online");
      },
      close() {
        closed = true;
        statusHandler?.("offline");
      },
      send(msg) {
        sent.push(msg);
      },
      onMessage(cb) {
        messageHandler = cb;
        return () => {
          messageHandler = null;
        };
      },
      onStatus(cb) {
        statusHandler = cb;
        return () => {
          statusHandler = null;
        };
      },
      setOnline() {},
      setLatency() {},
    };

    const storage = createMemoryStorage({ nodeId: "user_a" });
    const client = createSyncClient({
      boardId: "brd_err00001",
      nodeId: "user_a",
      storage,
      transport: fakeTransport,
      clock: createHlcClock({ nodeId: "user_a", now: () => 1_732_579_200_000 }),
      flushIntervalMs: 0,
    });

    await client.start();
    client.mutate([{ objectId: "obj_1", field: "x", value: 10 }]);
    const pushCountBefore = sent.filter((m) => (m as { type: string }).type === "SYNC_PUSH").length;
    expect(pushCountBefore).toBe(1);

    // Server responds RATE_LIMITED -> client schedules retry
    messageHandler!({ type: "ERROR", code: "RATE_LIMITED", message: "Slow down" });
    await new Promise((r) => setTimeout(r, 1_100));
    const pushCountAfter = sent.filter((m) => (m as { type: string }).type === "SYNC_PUSH").length;
    expect(pushCountAfter).toBeGreaterThanOrEqual(2);

    // Server responds BOARD_NOT_FOUND -> transport closed so no infinite reconnect
    messageHandler!({ type: "ERROR", code: "BOARD_NOT_FOUND", message: "Missing board" });
    expect(closed).toBe(true);

    await client.stop();
  });
});
