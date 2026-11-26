import {
  createFakeServer,
  createHlcClock,
  createMemoryStorage,
  createSyncClient,
} from "@synccanvas/sync-engine";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { WhiteboardCanvas } from "@/canvas/WhiteboardCanvas";
import { SyncProvider } from "@/sync";

afterEach(() => {
  cleanup();
});

async function mountCanvas() {
  const server = createFakeServer();
  const storage = createMemoryStorage({ nodeId: "user_a" });
  const clock = createHlcClock({ nodeId: "user_a", now: () => 1_732_579_200_000 });
  const transport = server.createTransport("user_a");
  const client = createSyncClient({
    boardId: "brd_canvas01",
    nodeId: "user_a",
    storage,
    transport,
    clock,
    flushIntervalMs: 0,
    fetchSnapshot: async () => server.getSnapshot(),
  });
  await client.start();

  const view = render(
    <div style={{ width: 800, height: 600 }}>
      <SyncProvider
        boardId="brd_canvas01"
        paneId="a"
        nodeId="user_a"
        client={client}
        autoStart={false}
      >
        <WhiteboardCanvas />
      </SyncProvider>
    </div>,
  );

  return { server, client, view };
}

describe("WhiteboardCanvas tools, property bar, and text editing (T25 + T27)", () => {
  it("creates a rect, updates fill via PropertyBar, and deletes it via tombstone", async () => {
    const { client, view } = await mountCanvas();

    // Select rect tool
    fireEvent.click(screen.getByTestId("tool-rect"));

    const canvasDiv = view.container.querySelector(".touch-none") as HTMLElement;
    fireEvent.pointerDown(canvasDiv, { button: 0, clientX: 100, clientY: 100, pointerId: 1 });
    fireEvent.pointerMove(canvasDiv, { clientX: 240, clientY: 190, pointerId: 1 });
    fireEvent.pointerUp(canvasDiv, { pointerId: 1 });

    const ids = client.map.visibleObjectIds();
    expect(ids).toHaveLength(1);
    const id = ids[0]!;
    expect(client.map.getObject(id)).toMatchObject({ type: "rect", w: 140, h: 90 });

    // PropertyBar is visible for the newly created selected object
    fireEvent.click(screen.getByTestId("fill-#fef08a"));
    expect(client.map.getObject(id)?.fill).toBe("#fef08a");

    // Delete marks tombstone
    fireEvent.click(screen.getByTestId("delete-object"));
    expect(client.map.visibleObjectIds()).toHaveLength(0);
    expect(client.map.get(id, "deleted")?.value).toBe(true);

    await client.stop();
  });

  it("creates a text object and commits a single text op on Ctrl+Enter", async () => {
    const { client, view } = await mountCanvas();

    fireEvent.click(screen.getByTestId("tool-text"));
    const canvasDiv = view.container.querySelector(".touch-none") as HTMLElement;
    fireEvent.pointerDown(canvasDiv, { button: 0, clientX: 150, clientY: 120, pointerId: 1 });

    const editor = screen.getByTestId("canvas-text-editor") as HTMLTextAreaElement;
    act(() => {
      fireEvent.change(editor, { target: { value: "Hello CRDT" } });
      fireEvent.keyDown(editor, { key: "Enter", ctrlKey: true });
    });

    const ids = client.map.visibleObjectIds();
    expect(ids).toHaveLength(1);
    expect(client.map.getObject(ids[0]!)).toMatchObject({
      type: "text",
      text: "Hello CRDT",
    });

    await client.stop();
  });
});
