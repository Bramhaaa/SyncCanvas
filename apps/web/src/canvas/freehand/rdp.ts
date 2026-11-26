import type { Point } from "@synccanvas/sync-engine";

export const MAX_FREEHAND_POINTS = 2000;

function perpendicularDistance(point: Point, lineStart: Point, lineEnd: Point): number {
  const [px, py] = point;
  const [x1, y1] = lineStart;
  const [x2, y2] = lineEnd;
  const dx = x2 - x1;
  const dy = y2 - y1;
  const lengthSq = dx * dx + dy * dy;

  if (lengthSq === 0) {
    return Math.hypot(px - x1, py - y1);
  }

  return Math.abs(dy * px - dx * py + x2 * y1 - y2 * x1) / Math.sqrt(lengthSq);
}

/**
 * Ramer-Douglas-Peucker polyline simplification.
 */
export function simplifyRdp(points: Point[], epsilon: number): Point[] {
  if (points.length <= 2 || epsilon <= 0) {
    return points.slice();
  }

  const stack: Array<[number, number]> = [[0, points.length - 1]];
  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;

  while (stack.length > 0) {
    const [start, end] = stack.pop()!;
    let maxDist = -1;
    let maxIdx = -1;

    const startPt = points[start]!;
    const endPt = points[end]!;
    for (let i = start + 1; i < end; i++) {
      const dist = perpendicularDistance(points[i]!, startPt, endPt);
      if (dist > maxDist) {
        maxDist = dist;
        maxIdx = i;
      }
    }

    if (maxDist > epsilon && maxIdx !== -1) {
      keep[maxIdx] = 1;
      stack.push([start, maxIdx], [maxIdx, end]);
    }
  }

  const result: Point[] = [];
  for (let i = 0; i < points.length; i++) {
    if (keep[i] === 1) {
      result.push(points[i]!);
    }
  }
  return result;
}

function downsampleToMax(points: Point[], maxPoints: number): Point[] {
  if (points.length <= maxPoints) return points;
  const result: Point[] = [];
  const step = (points.length - 1) / (maxPoints - 1);
  for (let i = 0; i < maxPoints - 1; i++) {
    result.push(points[Math.round(i * step)]!);
  }
  result.push(points[points.length - 1]!);
  return result;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/**
 * Simplifies world-space pointer points with RDP (`epsilon = 1.0 / zoom`),
 * caps length to `<= 2000`, and converts points relative to the stroke's `(x, y)` origin.
 */
export function normalizeFreehandPoints(
  worldPoints: Point[],
  zoom: number,
): { x: number; y: number; points: Point[] } {
  if (worldPoints.length === 0) {
    return { x: 0, y: 0, points: [[0, 0]] };
  }

  const safeZoom = Math.max(0.1, zoom);
  const simplified = simplifyRdp(worldPoints, 1.0 / safeZoom);
  const capped = downsampleToMax(simplified, MAX_FREEHAND_POINTS);

  let minX = Infinity;
  let minY = Infinity;
  for (const [px, py] of capped) {
    if (px < minX) minX = px;
    if (py < minY) minY = py;
  }

  const originX = round1(minX);
  const originY = round1(minY);
  const relativePoints: Point[] = capped.map(([px, py]) => [
    round1(px - originX),
    round1(py - originY),
  ]);

  return { x: originX, y: originY, points: relativePoints };
}

/**
 * Renders a sequence of points into a quadratic-Bézier smoothed SVG path `d` attribute.
 */
export function pointsToSmoothSvgPath(points: Point[]): string {
  if (points.length === 0) return "";
  const first = points[0]!;
  if (points.length === 1) {
    return `M ${first[0]} ${first[1]} L ${first[0] + 0.01} ${first[1]}`;
  }
  if (points.length === 2) {
    const second = points[1]!;
    return `M ${first[0]} ${first[1]} L ${second[0]} ${second[1]}`;
  }

  const segments: string[] = [`M ${first[0]} ${first[1]}`];
  for (let i = 1; i < points.length - 1; i++) {
    const curr = points[i]!;
    const next = points[i + 1]!;
    const midX = round1((curr[0] + next[0]) / 2);
    const midY = round1((curr[1] + next[1]) / 2);
    segments.push(`Q ${curr[0]} ${curr[1]} ${midX} ${midY}`);
  }
  const last = points[points.length - 1]!;
  segments.push(`L ${last[0]} ${last[1]}`);
  return segments.join(" ");
}
