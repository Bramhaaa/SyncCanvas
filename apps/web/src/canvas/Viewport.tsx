"use client";

import type { ReactNode } from "react";
import { viewportMatrix, type ViewportState } from "./viewport-math";

export interface ViewportProps {
  viewport: ViewportState;
  isPanning?: boolean;
  isSpacePressed?: boolean;
  cursor?: string;
  onWheel?: (e: React.WheelEvent<HTMLDivElement>) => void;
  onPointerDown?: (e: React.PointerEvent<HTMLDivElement>) => void;
  onPointerMove?: (e: React.PointerEvent<HTMLDivElement>) => void;
  onPointerUp?: (e: React.PointerEvent<HTMLDivElement>) => void;
  onDoubleClick?: (e: React.MouseEvent<HTMLDivElement>) => void;
  /** SVG world-space children rendered inside `<g transform="matrix(...)">`. */
  children: ReactNode;
  /** HTML world-space overlay children (e.g. text editor, remote cursors). */
  overlay?: ReactNode;
  /** Screen-space HUD elements (e.g. zoom pill). */
  hud?: ReactNode;
}

const GRID_STEP = 24;

export function Viewport({
  viewport,
  isPanning = false,
  isSpacePressed = false,
  cursor,
  onWheel,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onDoubleClick,
  children,
  overlay,
  hud,
}: ViewportProps) {
  const matrix = viewportMatrix(viewport);
  const gridSize = GRID_STEP * viewport.zoom;
  const resolvedCursor = isPanning ? "grabbing" : isSpacePressed ? "grab" : (cursor ?? "default");

  return (
    <div
      className="relative h-full w-full overflow-hidden select-none bg-[#fafafa] touch-none"
      style={{
        cursor: resolvedCursor,
        backgroundImage: "radial-gradient(circle, #d4d4d8 1px, transparent 1px)",
        backgroundSize: `${gridSize}px ${gridSize}px`,
        backgroundPosition: `${viewport.x}px ${viewport.y}px`,
      }}
      onWheel={onWheel}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onDoubleClick={onDoubleClick}
    >
      <svg className="block h-full w-full" xmlns="http://www.w3.org/2000/svg">
        <g transform={matrix}>{children}</g>
      </svg>

      {overlay !== undefined && (
        <div className="pointer-events-none absolute inset-0 overflow-hidden">
          <div
            className="absolute left-0 top-0"
            style={{
              transform: matrix,
              transformOrigin: "0 0",
            }}
          >
            {overlay}
          </div>
        </div>
      )}

      {hud}
    </div>
  );
}
