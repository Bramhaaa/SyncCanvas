import type { Point } from "@synccanvas/sync-engine";
import { describe, expect, it } from "vitest";
import {
  MAX_FREEHAND_POINTS,
  normalizeFreehandPoints,
  pointsToSmoothSvgPath,
  simplifyRdp,
} from "@/canvas/freehand";

describe("freehand RDP & SVG path (T26)", () => {
  it("simplifies collinear points down to endpoints", () => {
    const line: Point[] = [
      [0, 0],
      [10, 0],
      [20, 0.2],
      [30, 0],
      [40, 0],
    ];
    expect(simplifyRdp(line, 1)).toEqual([
      [0, 0],
      [40, 0],
    ]);
  });

  it("normalizes points relative to bounding origin and caps to 2,000 points", () => {
    const raw: Point[] = [];
    for (let i = 0; i < 3000; i++) {
      raw.push([100 + i * 2, 200 + (i % 2 === 0 ? 0 : 15)]);
    }
    const normalized = normalizeFreehandPoints(raw, 1);
    expect(normalized.x).toBe(100);
    expect(normalized.y).toBe(200);
    expect(normalized.points.length).toBeLessThanOrEqual(MAX_FREEHAND_POINTS);
    expect(normalized.points[0]).toEqual([0, 0]);
  });

  it("generates a smooth quadratic-Bézier SVG path", () => {
    const d = pointsToSmoothSvgPath([
      [0, 0],
      [10, 20],
      [30, 20],
      [40, 0],
    ]);
    expect(d.startsWith("M 0 0 Q 10 20")).toBe(true);
    expect(d.endsWith("L 40 0")).toBe(true);
  });

  it("keeps a 5-second scribble frame well under 64 KiB", () => {
    // 5 seconds at 120Hz = 600 pointer points along a smooth spiral
    const scribble: Point[] = [];
    for (let i = 0; i < 600; i++) {
      const t = i * 0.08;
      scribble.push([300 + Math.cos(t) * (20 + i * 0.3), 300 + Math.sin(t) * (20 + i * 0.3)]);
    }
    const { x, y, points } = normalizeFreehandPoints(scribble, 1);
    const frameJson = JSON.stringify({
      type: "SYNC_PUSH",
      clientId: "user_a",
      ops: [
        {
          objectId: "obj_scribble",
          field: "type",
          value: "freehand",
          hlc: "1732579200000:00000:user_a",
        },
        { objectId: "obj_scribble", field: "x", value: x, hlc: "1732579200000:00001:user_a" },
        { objectId: "obj_scribble", field: "y", value: y, hlc: "1732579200000:00002:user_a" },
        {
          objectId: "obj_scribble",
          field: "points",
          value: points,
          hlc: "1732579200000:00003:user_a",
        },
      ],
    });
    expect(new TextEncoder().encode(frameJson).byteLength).toBeLessThan(16_384);
  });
});
