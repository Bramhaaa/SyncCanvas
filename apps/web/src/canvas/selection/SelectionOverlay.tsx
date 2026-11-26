"use client";

import { useObject } from "@/sync";
import { asNumber, asString, getObjectBounds, type ResizeHandle } from "../tools/types";

export interface SelectionOverlayProps {
  selectedId: string;
  zoom: number;
  onHandlePointerDown: (
    handle: ResizeHandle,
    e: React.PointerEvent<SVGRectElement | SVGCircleElement>,
  ) => void;
}

export function SelectionOverlay({ selectedId, zoom, onHandlePointerDown }: SelectionOverlayProps) {
  const obj = useObject(selectedId);
  if (!obj) return null;

  const type = asString(obj.type, "rect");
  const inv = 1 / Math.max(0.1, zoom);
  const handleSize = 8 * inv;
  const strokeW = 1.5 * inv;

  if (type === "arrow") {
    const x1 = asNumber(obj.x, 0);
    const y1 = asNumber(obj.y, 0);
    const x2 = asNumber(obj.x2, x1 + 80);
    const y2 = asNumber(obj.y2, y1);
    return (
      <g data-testid="selection-overlay">
        <circle
          cx={x1}
          cy={y1}
          r={handleSize * 0.65}
          fill="#ffffff"
          stroke="#2563eb"
          strokeWidth={strokeW}
          style={{ cursor: "grab" }}
          onPointerDown={(e) => onHandlePointerDown("start", e)}
        />
        <circle
          cx={x2}
          cy={y2}
          r={handleSize * 0.65}
          fill="#ffffff"
          stroke="#2563eb"
          strokeWidth={strokeW}
          style={{ cursor: "grab" }}
          onPointerDown={(e) => onHandlePointerDown("end", e)}
        />
      </g>
    );
  }

  const bounds = getObjectBounds(obj);
  const pad = 4 * inv;
  const bx = bounds.x - pad;
  const by = bounds.y - pad;
  const bw = bounds.w + pad * 2;
  const bh = bounds.h + pad * 2;
  const resizable =
    type === "rect" || type === "ellipse" || type === "diamond" || type === "sticky";

  const corners: Array<{ handle: ResizeHandle; cx: number; cy: number; cursor: string }> = [
    { handle: "nw", cx: bx, cy: by, cursor: "nwse-resize" },
    { handle: "ne", cx: bx + bw, cy: by, cursor: "nesw-resize" },
    { handle: "sw", cx: bx, cy: by + bh, cursor: "nesw-resize" },
    { handle: "se", cx: bx + bw, cy: by + bh, cursor: "nwse-resize" },
  ];

  return (
    <g data-testid="selection-overlay">
      <rect
        x={bx}
        y={by}
        width={bw}
        height={bh}
        fill="none"
        stroke="#2563eb"
        strokeWidth={strokeW}
        strokeDasharray={`${4 * inv} ${3 * inv}`}
        pointerEvents="none"
      />
      {resizable &&
        corners.map((c) => (
          <rect
            key={c.handle}
            x={c.cx - handleSize / 2}
            y={c.cy - handleSize / 2}
            width={handleSize}
            height={handleSize}
            rx={1.5 * inv}
            fill="#ffffff"
            stroke="#2563eb"
            strokeWidth={strokeW}
            style={{ cursor: c.cursor }}
            data-resize-handle={c.handle}
            onPointerDown={(e) => onHandlePointerDown(c.handle, e)}
          />
        ))}
    </g>
  );
}
