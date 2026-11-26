import { IDBFactory, IDBKeyRange } from "fake-indexeddb";
import { describe, expect, it } from "vitest";
import { createIndexedDbStorage } from "../src/storage/indexeddb.js";
import { createMemoryStorage } from "../src/storage/memory.js";
import type { Op, Storage } from "../src/types.js";

function op(objectId: string, field: string, value: Op["value"], hlc: string): Op {
  return { objectId, field, value, hlc };
}

function runStorageSuite(name: string, factory: () => Storage): void {
  describe(`Storage (${name})`, () => {
    it("loads empty default state and meta", async () => {
      const storage = factory();
      try {
        const loaded = await storage.load();
        expect(loaded.state).toEqual({});
        expect(loaded.outbox).toEqual([]);
        expect(loaded.meta).toEqual({
          nodeId: "user_a",
          lastSyncedSeq: 0,
          lastHlc: null,
        });
      } finally {
        await storage.destroy();
      }
    });

    it("persists registers with LWW semantics and ignores stale overwrites", async () => {
      const storage = factory();
      try {
        await storage.putRegisters([
          op("obj_1", "type", "rect", "0000000001000:00000:user_a"),
          op("obj_1", "x", 100, "0000000001000:00001:user_a"),
          op("obj_1", "x", 200, "0000000001000:00002:user_a"),
        ]);

        // Stale write in a later transaction must not regress x
        await storage.putRegisters([
          op("obj_1", "x", 50, "0000000001000:00000:user_a"),
          op(
            "obj_1",
            "points",
            [
              [0, 0],
              [10, 20],
            ],
            "0000000001000:00003:user_a",
          ),
        ]);

        const { state } = await storage.load();
        expect(state).toEqual({
          obj_1: {
            type: { value: "rect", hlc: "0000000001000:00000:user_a" },
            x: { value: 200, hlc: "0000000001000:00002:user_a" },
            points: {
              value: [
                [0, 0],
                [10, 20],
              ],
              hlc: "0000000001000:00003:user_a",
            },
          },
        });
      } finally {
        await storage.destroy();
      }
    });

    it("coalesces outbox by (objectId, field) keeping the max HLC", async () => {
      const storage = factory();
      try {
        await storage.outboxPut([
          op("obj_1", "x", 10, "0000000001000:00001:user_a"),
          op("obj_1", "x", 30, "0000000001000:00003:user_a"),
          op("obj_1", "x", 20, "0000000001000:00002:user_a"),
          op("obj_1", "y", 5, "0000000001000:00000:user_a"),
        ]);

        // Older HLC in a subsequent call must not overwrite newer entry
        await storage.outboxPut([op("obj_1", "x", 15, "0000000001000:00002:user_a")]);

        const { outbox } = await storage.load();
        expect(outbox).toEqual([
          op("obj_1", "y", 5, "0000000001000:00000:user_a"),
          op("obj_1", "x", 30, "0000000001000:00003:user_a"),
        ]);
      } finally {
        await storage.destroy();
      }
    });

    it("removes only matching HLCs from outbox and preserves newer coalesced entries", async () => {
      const storage = factory();
      try {
        await storage.outboxPut([
          op("obj_1", "x", 10, "0000000001000:00001:user_a"),
          op("obj_1", "y", 20, "0000000001000:00002:user_a"),
        ]);
        // Coalesce x to a newer HLC before ack of old HLC arrives
        await storage.outboxPut([op("obj_1", "x", 40, "0000000001000:00005:user_a")]);

        // Ack the old x HLC and the current y HLC
        await storage.outboxRemove(["0000000001000:00001:user_a", "0000000001000:00002:user_a"]);

        const { outbox } = await storage.load();
        expect(outbox).toEqual([op("obj_1", "x", 40, "0000000001000:00005:user_a")]);
      } finally {
        await storage.destroy();
      }
    });

    it("patches meta incrementally without clobbering untouched fields", async () => {
      const storage = factory();
      try {
        await storage.setMeta({ lastSyncedSeq: 12 });
        await storage.setMeta({ lastHlc: "0000000001000:00009:user_a" });
        const { meta } = await storage.load();
        expect(meta).toEqual({
          nodeId: "user_a",
          lastSyncedSeq: 12,
          lastHlc: "0000000001000:00009:user_a",
        });
      } finally {
        await storage.destroy();
      }
    });

    it("clears all data on destroy", async () => {
      const storage = factory();
      await storage.putRegisters([op("obj_1", "x", 1, "0000000001000:00000:user_a")]);
      await storage.outboxPut([op("obj_1", "x", 1, "0000000001000:00000:user_a")]);
      await storage.setMeta({ lastSyncedSeq: 5, lastHlc: "0000000001000:00000:user_a" });
      await storage.destroy();

      const fresh = factory();
      try {
        const loaded = await fresh.load();
        expect(loaded.state).toEqual({});
        expect(loaded.outbox).toEqual([]);
        expect(loaded.meta.lastSyncedSeq).toBe(0);
      } finally {
        await fresh.destroy();
      }
    });
  });
}

runStorageSuite("MemoryStorage", () => createMemoryStorage({ nodeId: "user_a" }));

let idbCounter = 0;
runStorageSuite("IndexedDbStorage", () => {
  idbCounter += 1;
  return createIndexedDbStorage({
    boardId: `brd_test${idbCounter}`,
    paneId: "a",
    nodeId: "user_a",
    dexieOptions: {
      indexedDB: new IDBFactory(),
      IDBKeyRange,
    },
  });
});

describe("IndexedDbStorage persistence across reopen", () => {
  it("reloads persisted state, outbox, and meta from the same DB", async () => {
    const sharedIdb = new IDBFactory();
    const opts = {
      boardId: "brd_reload01",
      paneId: "pane_a",
      nodeId: "user_a",
      dexieOptions: { indexedDB: sharedIdb, IDBKeyRange },
    };

    const first = createIndexedDbStorage(opts);
    await first.putRegisters([op("obj_1", "type", "rect", "0000000001000:00000:user_a")]);
    await first.outboxPut([op("obj_1", "type", "rect", "0000000001000:00000:user_a")]);
    await first.setMeta({ lastSyncedSeq: 7, lastHlc: "0000000001000:00000:user_a" });

    const reopened = createIndexedDbStorage(opts);
    try {
      const loaded = await reopened.load();
      expect(loaded.state["obj_1"]?.["type"]?.value).toBe("rect");
      expect(loaded.outbox).toHaveLength(1);
      expect(loaded.meta).toEqual({
        nodeId: "user_a",
        lastSyncedSeq: 7,
        lastHlc: "0000000001000:00000:user_a",
      });
    } finally {
      await reopened.destroy();
    }
  });
});
