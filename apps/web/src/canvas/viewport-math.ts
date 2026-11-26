export interface ViewportState {
  /** Horizontal pan offset in screen pixels. */
  x: number;
  /** Vertical pan offset in screen pixels. */
  y: number;
  /** Zoom scale factor in [0.1, 4.0]. */
  zoom: number;
}

export interface WorldPoint {
  x: number;
  y: number;
}

export const MIN_ZOOM = 0.1;
export const MAX_ZOOM = 4.0;
export const DEFAULT_VIEWPORT: ViewportState = { x: 0, y: 0, zoom: 1 };

export function clampZoom(zoom: number): number {
  if (!Number.isFinite(zoom)) return 1;
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
}

export function screenToWorld(
  screenX: number,
  screenY: number,
  viewport: ViewportState,
): WorldPoint {
  return {
    x: (screenX - viewport.x) / viewport.zoom,
    y: (screenY - viewport.y) / viewport.zoom,
  };
}

export function worldToScreen(worldX: number, worldY: number, viewport: ViewportState): WorldPoint {
  return {
    x: worldX * viewport.zoom + viewport.x,
    y: worldY * viewport.zoom + viewport.y,
  };
}

/**
 * Zooms to `nextZoom` while keeping the world point under `(screenX, screenY)` fixed on screen.
 */
export function zoomAtPoint(
  viewport: ViewportState,
  nextZoom: number,
  screenX: number,
  screenY: number,
): ViewportState {
  const zoom = clampZoom(nextZoom);
  const world = screenToWorld(screenX, screenY, viewport);
  return {
    x: screenX - world.x * zoom,
    y: screenY - world.y * zoom,
    zoom,
  };
}

export function panBy(viewport: ViewportState, dx: number, dy: number): ViewportState {
  return {
    x: viewport.x + dx,
    y: viewport.y + dy,
    zoom: viewport.zoom,
  };
}

export function viewportMatrix(viewport: ViewportState): string {
  return `matrix(${viewport.zoom}, 0, 0, ${viewport.zoom}, ${viewport.x}, ${viewport.y})`;
}
