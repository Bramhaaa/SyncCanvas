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

async function mountCanvas(nodeId = "user_a") {
  const server = createFakeServer();
  const storage = createMemoryStorage({ nodeId });
  const clock = createHlcClock({ nodeId, now: () => 1_732_579_200_000 });
  const transport = server.createTransport(nodeId);
  const client = createSyncClient({
    boardId: "brd_canvas01",
    nodeId,
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
        nodeId={nodeId}
        client={client}
        autoStart={false}
      >
        <WhiteboardCanvas />
      </SyncProvider>
    </div>,
  );

  return { server, client, view };
}

describe("WhiteboardCanvas tools, property bar, undo/redo, and focus scoping", () => {
  it("creates a rect, updates fill via PropertyBar, undoes/redoes, and deletes via tombstone", async () => {
    const { client, view } = await mountCanvas();

    fireEvent.click(screen.getByTestId("tool-rect"));

    const canvasDiv = view.container.querySelector(".touch-none") as HTMLElement;
    fireEvent.pointerDown(canvasDiv, { button: 0, clientX: 100, clientY: 100, pointerId: 1 });
    fireEvent.pointerMove(canvasDiv, { clientX: 240, clientY: 190, pointerId: 1 });
    fireEvent.pointerUp(canvasDiv, { pointerId: 1 });

    const ids = client.map.visibleObjectIds();
    expect(ids).toHaveLength(1);
    const id = ids[0]!;
    expect(client.map.getObject(id)).toMatchObject({ type: "rect", w: 140, h: 90 });

    // Recolor via PropertyBar then Undo & Redo
    fireEvent.click(screen.getByTestId("fill-#fef08a"));
    expect(client.map.getObject(id)?.fill).toBe("#fef08a");

    fireEvent.click(screen.getByTestId("undo-button"));
    expect(client.map.getObject(id)?.fill).toBe("#dbeafe");

    fireEvent.click(screen.getByTestId("redo-button"));
    expect(client.map.getObject(id)?.fill).toBe("#fef08a");

    // Delete marks tombstone
    fireEvent.click(screen.getByTestId("delete-object"));
    expect(client.map.visibleObjectIds()).toHaveLength(0);
    expect(client.map.get(id, "deleted")?.value).toBe(true);

    await client.stop();
  });

  it("creates a text object and sticky note and commits text on Ctrl+Enter", async () => {
    const { client, view } = await mountCanvas();

    fireEvent.click(screen.getByTestId("tool-text"));
    const canvasDiv = view.container.querySelector(".touch-none") as HTMLElement;
    fireEvent.pointerDown(canvasDiv, { button: 0, clientX: 150, clientY: 120, pointerId: 1 });

    const editor = screen.getByTestId("canvas-text-editor") as HTMLTextAreaElement;
    act(() => {
      fireEvent.change(editor, { target: { value: "Hello CRDT" } });
      fireEvent.keyDown(editor, { key: "Enter", ctrlKey: true });
    });

    expect(client.map.visibleObjectIds()).toHaveLength(1);
    expect(client.map.getObject(client.map.visibleObjectIds()[0]!)).toMatchObject({
      type: "text",
      text: "Hello CRDT",
    });

    // Create a sticky note -> opens editor immediately
    fireEvent.click(screen.getByTestId("tool-sticky"));
    fireEvent.pointerDown(canvasDiv, { button: 0, clientX: 300, clientY: 200, pointerId: 2 });
    const stickyEditor = screen.getByTestId("canvas-text-editor") as HTMLTextAreaElement;
    act(() => {
      fireEvent.change(stickyEditor, { target: { value: "Sticky note" } });
      fireEvent.keyDown(stickyEditor, { key: "Enter", ctrlKey: true });
    });
    expect(client.map.visibleObjectIds()).toHaveLength(2);

    await client.stop();
  });

  it("scopes keyboard shortcuts to the focused pane so split-screen panes do not collide", async () => {
    const server = createFakeServer();
    const clientA = createSyncClient({
      boardId: "brd_focus01",
      nodeId: "user_a",
      storage: createMemoryStorage({ nodeId: "user_a" }),
      transport: server.createTransport("user_a"),
      clock: createHlcClock({ nodeId: "user_a", now: () => 1_732_579_200_000 }),
      flushIntervalMs: 0,
    });
    const clientB = createSyncClient({
      boardId: "brd_focus01",
      nodeId: "user_b",
      storage: createMemoryStorage({ nodeId: "user_b" }),
      transport: server.createTransport("user_b"),
      clock: createHlcClock({ nodeId: "user_b", now: () => 1_732_579_200_000 }),
      flushIntervalMs: 0,
    });
    await Promise.all([clientA.start(), clientB.start()]);

    const view = render(
      <div>
        <div data-testid="wrap-a">
          <SyncProvider boardId="brd_focus01" paneId="a" client={clientA} autoStart={false}>
            <WhiteboardCanvas />
          </SyncProvider>
        </div>
        <div data-testid="wrap-b">
          <SyncProvider boardId="brd_focus01" paneId="b" client={clientB} autoStart={false}>
            <WhiteboardCanvas />
          </SyncProvider>
        </div>
      </div>,
    );

    const canvases = view.container.querySelectorAll<HTMLElement>(".touch-none");
    expect(canvases).toHaveLength(2);

    // Press 'r' inside Pane A only -> Pane A activates rect, Pane B stays on select!
    fireEvent.keyDown(canvases[0]!, { key: "r" });

    const rectBtns = screen.getAllByTestId("tool-rect");
    expect(rectBtns[0]!.getAttribute("aria-pressed")).toBe("true");
    expect(rectBtns[1]!.getAttribute("aria-pressed")).toBe("false");

    await Promise.all([clientA.stop(), clientB.stop()]);
  });
});
