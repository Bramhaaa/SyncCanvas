import {
  createFakeServer,
  createHlcClock,
  createMemoryStorage,
  createSyncClient,
} from "@synccanvas/sync-engine";
import { act, cleanup, render, screen } from "@testing-library/react";
import { memo } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { SyncProvider, useConnStatus, useObject, useSyncEvents, useVisibleIds } from "@/sync";

afterEach(() => {
  cleanup();
});

function createTestClient(nodeId = "user_a") {
  const server = createFakeServer();
  const storage = createMemoryStorage({ nodeId });
  const clock = createHlcClock({ nodeId, now: () => 1_732_579_200_000 });
  const transport = server.createTransport(nodeId);
  const client = createSyncClient({
    boardId: "brd_react01",
    nodeId,
    storage,
    transport,
    clock,
    flushIntervalMs: 0,
    fetchSnapshot: async () => server.getSnapshot(),
  });
  return { server, client };
}

describe("React sync binding (T23)", () => {
  it("re-renders only the mutated object's component when another object changes", async () => {
    const { client } = createTestClient();
    await client.start();

    client.mutate([
      { objectId: "obj_a", field: "type", value: "rect" },
      { objectId: "obj_a", field: "x", value: 10 },
      { objectId: "obj_a", field: "zIndex", value: "a0" },
      { objectId: "obj_b", field: "type", value: "rect" },
      { objectId: "obj_b", field: "x", value: 20 },
      { objectId: "obj_b", field: "zIndex", value: "a1" },
    ]);

    const renders = { a: 0, b: 0 };

    const ShapeA = memo(function ShapeA() {
      renders.a += 1;
      const obj = useObject("obj_a");
      return <div data-testid="shape-a">{String(obj?.x ?? "")}</div>;
    });

    const ShapeB = memo(function ShapeB() {
      renders.b += 1;
      const obj = useObject("obj_b");
      return <div data-testid="shape-b">{String(obj?.x ?? "")}</div>;
    });

    render(
      <SyncProvider
        boardId="brd_react01"
        paneId="a"
        nodeId="user_a"
        client={client}
        autoStart={false}
      >
        <ShapeA />
        <ShapeB />
      </SyncProvider>,
    );

    expect(screen.getByTestId("shape-a").textContent).toBe("10");
    expect(screen.getByTestId("shape-b").textContent).toBe("20");
    const initialA = renders.a;
    const initialB = renders.b;

    act(() => {
      client.mutate([{ objectId: "obj_a", field: "x", value: 99 }]);
    });

    expect(screen.getByTestId("shape-a").textContent).toBe("99");
    expect(renders.a).toBe(initialA + 1);
    expect(renders.b).toBe(initialB);

    await client.stop();
  });

  it("exposes visible IDs, connection status, and a 200-event ring buffer", async () => {
    const { client } = createTestClient();

    function StatusProbe() {
      const ids = useVisibleIds();
      const status = useConnStatus();
      const events = useSyncEvents();
      return (
        <div>
          <span data-testid="ids">{ids.join(",")}</span>
          <span data-testid="status">{status}</span>
          <span data-testid="event-count">{events.length}</span>
        </div>
      );
    }

    render(
      <SyncProvider
        boardId="brd_react01"
        paneId="a"
        nodeId="user_a"
        client={client}
        autoStart={false}
      >
        <StatusProbe />
      </SyncProvider>,
    );

    await act(async () => {
      await client.start();
    });

    expect(screen.getByTestId("status").textContent).toBe("online");

    act(() => {
      client.mutate([
        { objectId: "obj_1", field: "type", value: "rect" },
        { objectId: "obj_1", field: "zIndex", value: "a0" },
      ]);
      // Push > 200 events to verify ring buffer cap
      for (let i = 0; i < 250; i++) {
        client.mutate([{ objectId: "obj_1", field: "x", value: i }]);
      }
    });

    expect(screen.getByTestId("ids").textContent).toBe("obj_1");
    expect(Number(screen.getByTestId("event-count").textContent)).toBe(200);

    await client.stop();
  });
});
