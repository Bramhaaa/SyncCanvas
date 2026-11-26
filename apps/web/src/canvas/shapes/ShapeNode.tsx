"use client";

import { memo } from "react";
import { useObject } from "@/sync";
import { pointsToSmoothSvgPath } from "../freehand";
import { asNumber, asPoints, asString } from "../tools/types";

export interface ShapeNodeProps {
  id: string;
  isEditing?: boolean;
  onPointerDown: (id: string, e: React.PointerEvent<SVGGElement>) => void;
  onDoubleClick: (id: string, e: React.MouseEvent<SVGGElement>) => void;
}

function arrowHeadPoints(x1: number, y1: number, x2: number, y2: number, size: number): string {
  const angle = Math.atan2(y2 - y1, x2 - x1);
  const spread = Math.PI / 6;
  const p1x = x2 - size * Math.cos(angle - spread);
  const p1y = y2 - size * Math.sin(angle - spread);
  const p2x = x2 - size * Math.cos(angle + spread);
  const p2y = y2 - size * Math.sin(angle + spread);
  return `${p1x},${p1y} ${x2},${y2} ${p2x},${p2y}`;
}

export const ShapeNode = memo(function ShapeNode({
  id,
  isEditing = false,
  onPointerDown,
  onDoubleClick,
}: ShapeNodeProps) {
  const obj = useObject(id);
  if (!obj) return null;

  const type = asString(obj.type, "rect");
  const x = asNumber(obj.x, 0);
  const y = asNumber(obj.y, 0);
  const stroke = asString(obj.stroke, "#1f2937");
  const strokeWidth = asNumber(obj.strokeWidth, 2);
  const opacity = asNumber(obj.opacity, 1);

  return (
    <g
      data-object-id={id}
      data-object-type={type}
      opacity={opacity}
      onPointerDown={(e) => onPointerDown(id, e)}
      onDoubleClick={(e) => onDoubleClick(id, e)}
      style={{ cursor: "move" }}
    >
      {type === "rect" && (
        <rect
          x={x}
          y={y}
          width={Math.max(1, asNumber(obj.w, 100))}
          height={Math.max(1, asNumber(obj.h, 80))}
          rx={4}
          fill={asString(obj.fill, "transparent")}
          stroke={stroke}
          strokeWidth={strokeWidth}
        />
      )}

      {type === "ellipse" &&
        (() => {
          const w = Math.max(1, asNumber(obj.w, 100));
          const h = Math.max(1, asNumber(obj.h, 80));
          return (
            <ellipse
              cx={x + w / 2}
              cy={y + h / 2}
              rx={w / 2}
              ry={h / 2}
              fill={asString(obj.fill, "transparent")}
              stroke={stroke}
              strokeWidth={strokeWidth}
            />
          );
        })()}

      {type === "diamond" &&
        (() => {
          const w = Math.max(1, asNumber(obj.w, 100));
          const h = Math.max(1, asNumber(obj.h, 80));
          const pts = `${x + w / 2},${y} ${x + w},${y + h / 2} ${x + w / 2},${y + h} ${x},${y + h / 2}`;
          return (
            <polygon
              points={pts}
              fill={asString(obj.fill, "transparent")}
              stroke={stroke}
              strokeWidth={strokeWidth}
            />
          );
        })()}

      {type === "sticky" &&
        (() => {
          const w = Math.max(1, asNumber(obj.w, 160));
          const h = Math.max(1, asNumber(obj.h, 120));
          const text = asString(obj.text, "");
          const fontSize = asNumber(obj.fontSize, 16);
          return (
            <>
              <rect
                x={x}
                y={y}
                width={w}
                height={h}
                rx={6}
                fill={asString(obj.fill, "#fef08a")}
                stroke={stroke}
                strokeWidth={strokeWidth}
              />
              {!isEditing && (
                <text
                  x={x + 12}
                  y={y + 12 + fontSize}
                  fill="#1f2937"
                  fontSize={fontSize}
                  fontFamily="system-ui, sans-serif"
                >
                  {text.split("\n").map((line, i) => (
                    <tspan key={i} x={x + 12} dy={i === 0 ? 0 : fontSize * 1.3}>
                      {line}
                    </tspan>
                  ))}
                </text>
              )}
            </>
          );
        })()}

      {type === "arrow" &&
        (() => {
          const x2 = asNumber(obj.x2, x + 80);
          const y2 = asNumber(obj.y2, y);
          const head = asString(obj.arrowHead, "end");
          const headSize = Math.max(10, strokeWidth * 4.5);
          return (
            <>
              {/* Invisible wider hit target for easier selection */}
              <line
                x1={x}
                y1={y}
                x2={x2}
                y2={y2}
                stroke="transparent"
                strokeWidth={Math.max(14, strokeWidth + 10)}
              />
              <line
                x1={x}
                y1={y}
                x2={x2}
                y2={y2}
                stroke={stroke}
                strokeWidth={strokeWidth}
                strokeLinecap="round"
              />
              {(head === "end" || head === "both") && (
                <polyline
                  points={arrowHeadPoints(x, y, x2, y2, headSize)}
                  fill="none"
                  stroke={stroke}
                  strokeWidth={strokeWidth}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              )}
              {head === "both" && (
                <polyline
                  points={arrowHeadPoints(x2, y2, x, y, headSize)}
                  fill="none"
                  stroke={stroke}
                  strokeWidth={strokeWidth}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              )}
            </>
          );
        })()}

      {type === "freehand" &&
        (() => {
          const points = asPoints(obj.points);
          const d = pointsToSmoothSvgPath(points);
          return (
            <g transform={`translate(${x}, ${y})`}>
              <path
                d={d}
                fill="none"
                stroke="transparent"
                strokeWidth={Math.max(14, strokeWidth + 10)}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <path
                d={d}
                fill="none"
                stroke={stroke}
                strokeWidth={strokeWidth}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </g>
          );
        })()}

      {type === "text" &&
        !isEditing &&
        (() => {
          const text = asString(obj.text, "");
          const fontSize = asNumber(obj.fontSize, 16);
          const lines = (text || "Double-click to edit").split("\n");
          return (
            <text
              x={x}
              y={y + fontSize}
              fill={text ? stroke : "#9ca3af"}
              fontSize={fontSize}
              fontFamily="system-ui, sans-serif"
            >
              {lines.map((line, i) => (
                <tspan key={i} x={x} dy={i === 0 ? 0 : fontSize * 1.35}>
                  {line || " "}
                </tspan>
              ))}
            </text>
          );
        })()}
    </g>
  );
});
