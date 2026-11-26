import type { FieldValue, Point } from "@synccanvas/sync-engine";

export type Tool = "select" | "rect" | "ellipse" | "arrow" | "freehand" | "text";

export type ResizeHandle = "nw" | "ne" | "sw" | "se" | "start" | "end";

export interface Bounds {
  x: number;
  y: number;
  w: number;
  h: number;
}

const BASE36 = "0123456789abcdefghijklmnopqrstuvwxyz";

/** Generates `obj_` + 10 random base36 chars per spec/protocol.md §1. */
export function generateObjectId(): string {
  let suffix = "";
  for (let i = 0; i < 10; i++) {
    suffix += BASE36[Math.floor(Math.random() * BASE36.length)];
  }
  return `obj_${suffix}`;
}

export function asNumber(val: FieldValue | undefined, fallback: number): number {
  return typeof val === "number" && Number.isFinite(val) ? val : fallback;
}

export function asString(val: FieldValue | undefined, fallback: string): string {
  return typeof val === "string" ? val : fallback;
}

export function asPoints(val: FieldValue | undefined): Point[] {
  return Array.isArray(val) ? val : [];
}

export function getObjectBounds(obj: Record<string, FieldValue>): Bounds {
  const type = asString(obj.type, "rect");
  const x = asNumber(obj.x, 0);
  const y = asNumber(obj.y, 0);

  if (type === "arrow") {
    const x2 = asNumber(obj.x2, x + 80);
    const y2 = asNumber(obj.y2, y);
    const minX = Math.min(x, x2);
    const minY = Math.min(y, y2);
    return {
      x: minX,
      y: minY,
      w: Math.max(8, Math.abs(x2 - x)),
      h: Math.max(8, Math.abs(y2 - y)),
    };
  }

  if (type === "freehand") {
    const pts = asPoints(obj.points);
    if (pts.length === 0) return { x, y, w: 16, h: 16 };
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const [px, py] of pts) {
      if (px < minX) minX = px;
      if (py < minY) minY = py;
      if (px > maxX) maxX = px;
      if (py > maxY) maxY = py;
    }
    return {
      x: x + minX,
      y: y + minY,
      w: Math.max(12, maxX - minX),
      h: Math.max(12, maxY - minY),
    };
  }

  if (type === "text") {
    const text = asString(obj.text, "");
    const fontSize = asNumber(obj.fontSize, 16);
    const lines = (text || "Text").split("\n");
    const longest = Math.max(...lines.map((l) => l.length), 4);
    return {
      x,
      y,
      w: Math.max(48, longest * fontSize * 0.62),
      h: Math.max(fontSize * 1.4, lines.length * fontSize * 1.35),
    };
  }

  return {
    x,
    y,
    w: Math.max(1, asNumber(obj.w, 100)),
    h: Math.max(1, asNumber(obj.h, 80)),
  };
}
