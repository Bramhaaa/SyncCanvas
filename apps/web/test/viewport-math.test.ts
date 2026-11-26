import { describe, expect, it } from "vitest";
import {
  clampZoom,
  MAX_ZOOM,
  MIN_ZOOM,
  panBy,
  screenToWorld,
  viewportMatrix,
  worldToScreen,
  zoomAtPoint,
} from "@/canvas/viewport-math";

describe("viewport-math (T24)", () => {
  it("clamps zoom to [10%, 400%]", () => {
    expect(clampZoom(0.01)).toBe(MIN_ZOOM);
    expect(clampZoom(10)).toBe(MAX_ZOOM);
    expect(clampZoom(1.5)).toBe(1.5);
    expect(clampZoom(Number.NaN)).toBe(1);
  });

  it("round-trips screenToWorld and worldToScreen", () => {
    const vp = { x: 120, y: -45, zoom: 2.5 };
    const world = screenToWorld(370, 205, vp);
    expect(world).toEqual({ x: 100, y: 100 });
    expect(worldToScreen(world.x, world.y, vp)).toEqual({ x: 370, y: 205 });
  });

  it("keeps the cursor world point anchored during zoomAtPoint", () => {
    const vp = { x: 40, y: 80, zoom: 1 };
    const cursorX = 300;
    const cursorY = 200;
    const worldBefore = screenToWorld(cursorX, cursorY, vp);

    const zoomed = zoomAtPoint(vp, 2.25, cursorX, cursorY);
    const worldAfter = screenToWorld(cursorX, cursorY, zoomed);

    expect(worldAfter.x).toBeCloseTo(worldBefore.x, 8);
    expect(worldAfter.y).toBeCloseTo(worldBefore.y, 8);
    expect(zoomed.zoom).toBe(2.25);
  });

  it("pans and formats CSS/SVG transform matrix", () => {
    const vp = panBy({ x: 10, y: 20, zoom: 1.5 }, -5, 15);
    expect(vp).toEqual({ x: 5, y: 35, zoom: 1.5 });
    expect(viewportMatrix(vp)).toBe("matrix(1.5, 0, 0, 1.5, 5, 35)");
  });
});
