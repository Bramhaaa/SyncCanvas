import {
  createFakeServer,
  createHlcClock,
  createMemoryStorage,
  createSyncClient,
} from "@synccanvas/sync-engine";
import { describe, expect, it } from "vitest";
import { DEMO_RECT_ID, runConflictDemo, seedStarterBoard } from "@/playground/chaos/conflict-demo";

describe("Conflict Demo (T41)", () => {
  it("preserves both A's offline move and B's online recolor with identical state hashes", async () => {
    const server = createFakeServer();
    const clientA = createSyncClient({
      boardId: "brd_demo0001",
      nodeId: "user_a",
      storage: createMemoryStorage({ nodeId: "user_a" }),
      transport: server.createTransport("user_a"),
      clock: createHlcClock({ nodeId: "user_a", now: () => 1_732_579_200_000 }),
      flushIntervalMs: 0,
      fetchSnapshot: async () => server.getSnapshot(),
    });
    const clientB = createSyncClient({
      boardId: "brd_demo0001",
      nodeId: "user_b",
      storage: createMemoryStorage({ nodeId: "user_b" }),
      transport: server.createTransport("user_b"),
      clock: createHlcClock({ nodeId: "user_b", now: () => 1_732_579_200_000 }),
      flushIntervalMs: 0,
      fetchSnapshot: async () => server.getSnapshot(),
    });

    await Promise.all([clientA.start(), clientB.start()]);
    seedStarterBoard(clientA);

    const captions: string[] = [];
    const onlineChanges: boolean[] = [];

    await runConflictDemo(clientA, clientB, {
      onCaption: (c) => captions.push(c),
      onOnlineA: (v) => onlineChanges.push(v),
      stepDelayMs: 5,
    });

    await new Promise((r) => setTimeout(r, 10));

    expect(captions).toHaveLength(6);
    expect(onlineChanges).toEqual([false, true]);
    expect(await clientA.map.stateHash()).toBe(await clientB.map.stateHash());
    expect(clientA.map.getObject(DEMO_RECT_ID)).toMatchObject({
      x: 320,
      fill: "#dcfce7",
      stroke: "#16a34a",
    });

    await Promise.all([clientA.stop(), clientB.stop()]);
  });
});
