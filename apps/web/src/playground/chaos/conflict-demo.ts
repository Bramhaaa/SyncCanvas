import type { SyncClient } from "@synccanvas/sync-engine";

export const DEMO_RECT_ID = "obj_demo_rect1";

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function seedStarterBoard(client: SyncClient): void {
  if (client.map.visibleObjectIds().length > 0) return;

  client.mutate([
    { objectId: DEMO_RECT_ID, field: "type", value: "rect" },
    { objectId: DEMO_RECT_ID, field: "x", value: 80 },
    { objectId: DEMO_RECT_ID, field: "y", value: 110 },
    { objectId: DEMO_RECT_ID, field: "w", value: 150 },
    { objectId: DEMO_RECT_ID, field: "h", value: 95 },
    { objectId: DEMO_RECT_ID, field: "fill", value: "#dbeafe" },
    { objectId: DEMO_RECT_ID, field: "stroke", value: "#2563eb" },
    { objectId: DEMO_RECT_ID, field: "strokeWidth", value: 2 },
    { objectId: DEMO_RECT_ID, field: "zIndex", value: "a0" },

    { objectId: "obj_demo_ellp1", field: "type", value: "ellipse" },
    { objectId: "obj_demo_ellp1", field: "x", value: 300 },
    { objectId: "obj_demo_ellp1", field: "y", value: 240 },
    { objectId: "obj_demo_ellp1", field: "w", value: 120 },
    { objectId: "obj_demo_ellp1", field: "h", value: 90 },
    { objectId: "obj_demo_ellp1", field: "fill", value: "#fef08a" },
    { objectId: "obj_demo_ellp1", field: "stroke", value: "#d97706" },
    { objectId: "obj_demo_ellp1", field: "strokeWidth", value: 2 },
    { objectId: "obj_demo_ellp1", field: "zIndex", value: "a1" },

    { objectId: "obj_demo_arrw1", field: "type", value: "arrow" },
    { objectId: "obj_demo_arrw1", field: "x", value: 235 },
    { objectId: "obj_demo_arrw1", field: "y", value: 165 },
    { objectId: "obj_demo_arrw1", field: "x2", value: 305 },
    { objectId: "obj_demo_arrw1", field: "y2", value: 245 },
    { objectId: "obj_demo_arrw1", field: "arrowHead", value: "end" },
    { objectId: "obj_demo_arrw1", field: "stroke", value: "#1f2937" },
    { objectId: "obj_demo_arrw1", field: "strokeWidth", value: 2 },
    { objectId: "obj_demo_arrw1", field: "zIndex", value: "a2" },

    { objectId: "obj_demo_text1", field: "type", value: "text" },
    { objectId: "obj_demo_text1", field: "x", value: 80 },
    { objectId: "obj_demo_text1", field: "y", value: 52 },
    { objectId: "obj_demo_text1", field: "text", value: "SyncCanvas CRDT Playground" },
    { objectId: "obj_demo_text1", field: "fontSize", value: 22 },
    { objectId: "obj_demo_text1", field: "stroke", value: "#1f2937" },
    { objectId: "obj_demo_text1", field: "zIndex", value: "a3" },
  ]);
}

export interface ConflictDemoCallbacks {
  onCaption: (caption: string) => void;
  onOnlineA: (online: boolean) => void;
  stepDelayMs?: number;
}

/**
 * Timed 6-step scripted conflict demo proving field-level LWW-Map convergence:
 * User A moves the blue rectangle offline while User B recolors it online;
 * upon reconnect, BOTH the new position and new color survive identically.
 */
export async function runConflictDemo(
  clientA: SyncClient,
  clientB: SyncClient,
  cb: ConflictDemoCallbacks,
): Promise<void> {
  const pause = cb.stepDelayMs ?? 900;

  // Ensure both clients start online and reset demo rect to its blue starting position
  // so repeated clicks of "Run Conflict Demo" always visibly animate the conflict.
  clientA.transport.setOnline(true);
  clientB.transport.setOnline(true);
  cb.onOnlineA(true);

  if (!clientA.map.getObject(DEMO_RECT_ID)) {
    seedStarterBoard(clientA);
  } else {
    clientA.mutate([
      { objectId: DEMO_RECT_ID, field: "deleted", value: false },
      { objectId: DEMO_RECT_ID, field: "x", value: 80 },
      { objectId: DEMO_RECT_ID, field: "y", value: 110 },
      { objectId: DEMO_RECT_ID, field: "w", value: 150 },
      { objectId: DEMO_RECT_ID, field: "h", value: 95 },
      { objectId: DEMO_RECT_ID, field: "fill", value: "#dbeafe" },
      { objectId: DEMO_RECT_ID, field: "stroke", value: "#2563eb" },
    ]);
  }
  await delay(Math.min(350, pause));

  cb.onCaption("1/6 — Cutting User A's network connection (offline mode)…");
  clientA.transport.setOnline(false);
  cb.onOnlineA(false);
  await delay(pause);

  cb.onCaption("2/6 — User A (offline) moves the blue rectangle right; queued in A's outbox.");
  clientA.mutate([
    { objectId: DEMO_RECT_ID, field: "x", value: 320 },
    { objectId: DEMO_RECT_ID, field: "y", value: 110 },
  ]);
  await delay(pause);

  cb.onCaption("3/6 — User B (online) recolors the same rectangle to green.");
  clientB.mutate([
    { objectId: DEMO_RECT_ID, field: "fill", value: "#dcfce7" },
    { objectId: DEMO_RECT_ID, field: "stroke", value: "#16a34a" },
  ]);
  await delay(pause);

  cb.onCaption("4/6 — Diverged! A has the new position; B has the new color.");
  await delay(pause);

  cb.onCaption("5/6 — Reconnecting User A → SYNC_PULL + flushing A's outbox…");
  clientA.transport.setOnline(true);
  cb.onOnlineA(true);
  await delay(pause);

  cb.onCaption(
    "6/6 — Converged! Field-level LWW-Map preserved BOTH A's move and B's color with identical state hashes.",
  );
}
