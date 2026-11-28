import { describe, expect, it } from "vitest";
import { createHlcClock } from "../src/hlc.js";
import { createMemoryStorage } from "../src/storage/memory.js";
import { createSyncClient } from "../src/sync-client.js";
import { createFakeServer } from "../src/transport/loopback.js";
import { createUndoManager } from "../src/undo.js";

describe("Ownership-checked CRDT UndoManager (T60)", () => {
  it("undoes and redoes local edits cleanly, including object creation and deletion", async () => {
    const server = createFakeServer();
    const client = createSyncClient({
      boardId: "brd_undo0001",
      nodeId: "user_a",
      storage: createMemoryStorage({ nodeId: "user_a" }),
      transport: server.createTransport("user_a"),
      clock: createHlcClock({ nodeId: "user_a", now: () => 1_732_579_200_000 }),
      flushIntervalMs: 0,
      fetchSnapshot: async () => server.getSnapshot(),
    });
    await client.start();

    const undo = createUndoManager(client);
    expect(undo.canUndo()).toBe(false);

    // Create a rect
    undo.mutate([
      { objectId: "obj_1", field: "type", value: "rect" },
      { objectId: "obj_1", field: "x", value: 10 },
      { objectId: "obj_1", field: "fill", value: "#dbeafe" },
    ]);
    expect(client.map.visibleObjectIds()).toEqual(["obj_1"]);

    // Move it
    undo.mutate([{ objectId: "obj_1", field: "x", value: 120 }]);
    expect(client.map.getObject("obj_1")?.x).toBe(120);

    // Undo move -> back to 10
    undo.undo();
    expect(client.map.getObject("obj_1")?.x).toBe(10);
    expect(undo.canRedo()).toBe(true);

    // Redo move -> back to 120
    undo.redo();
    expect(client.map.getObject("obj_1")?.x).toBe(120);

    // Undo move then undo creation -> object tombstoned
    undo.undo();
    undo.undo();
    expect(client.map.visibleObjectIds()).toEqual([]);

    // Redo creation -> object restored (deleted = false)
    undo.redo();
    expect(client.map.visibleObjectIds()).toEqual(["obj_1"]);

    await client.stop();
  });

  it("never reverts a field that a peer has subsequently edited (ownership check)", async () => {
    const server = createFakeServer();
    let nowMs = 1_732_579_200_000;

    const clientA = createSyncClient({
      boardId: "brd_undo0002",
      nodeId: "user_a",
      storage: createMemoryStorage({ nodeId: "user_a" }),
      transport: server.createTransport("user_a"),
      clock: createHlcClock({ nodeId: "user_a", now: () => nowMs }),
      flushIntervalMs: 0,
      fetchSnapshot: async () => server.getSnapshot(),
    });
    const clientB = createSyncClient({
      boardId: "brd_undo0002",
      nodeId: "user_b",
      storage: createMemoryStorage({ nodeId: "user_b" }),
      transport: server.createTransport("user_b"),
      clock: createHlcClock({ nodeId: "user_b", now: () => nowMs }),
      flushIntervalMs: 0,
      fetchSnapshot: async () => server.getSnapshot(),
    });

    await Promise.all([clientA.start(), clientB.start()]);
    const undoA = createUndoManager(clientA);

    clientA.mutate([
      { objectId: "obj_1", field: "type", value: "rect" },
      { objectId: "obj_1", field: "x", value: 50 },
      { objectId: "obj_1", field: "y", value: 50 },
    ]);

    // A moves both x and y
    nowMs += 100;
    undoA.mutate([
      { objectId: "obj_1", field: "x", value: 200 },
      { objectId: "obj_1", field: "y", value: 200 },
    ]);

    // Peer B later edits ONLY x to 400
    nowMs += 100;
    clientB.mutate([{ objectId: "obj_1", field: "x", value: 400 }]);

    expect(clientA.map.getObject("obj_1")).toMatchObject({ x: 400, y: 200 });

    // A presses Ctrl+Z -> y reverts to 50 (still owned by A), but x stays 400 (owned by B!)
    nowMs += 100;
    undoA.undo();

    expect(clientA.map.getObject("obj_1")).toMatchObject({ x: 400, y: 50 });
    expect(clientB.map.getObject("obj_1")).toMatchObject({ x: 400, y: 50 });

    await Promise.all([clientA.stop(), clientB.stop()]);
  });
});
