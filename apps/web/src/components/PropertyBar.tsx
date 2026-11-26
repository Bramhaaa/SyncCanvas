"use client";

import { bringToFront, sendToBack } from "@synccanvas/sync-engine";
import { asNumber, asString } from "@/canvas/tools/types";
import { useObject, useSyncClient, useVisibleIds } from "@/sync";

export interface PropertyBarProps {
  selectedId: string;
  onDeleted: () => void;
}

const FILL_SWATCHES = [
  "transparent",
  "#dbeafe",
  "#fef08a",
  "#dcfce7",
  "#fee2e2",
  "#f3e8ff",
  "#1f2937",
];
const STROKE_SWATCHES = ["#1f2937", "#2563eb", "#dc2626", "#16a34a", "#d97706", "#7c3aed"];
const STROKE_WIDTHS = [1, 2, 4, 8];
const FONT_SIZES = [14, 18, 24, 36];

export function PropertyBar({ selectedId, onDeleted }: PropertyBarProps) {
  const client = useSyncClient();
  const visibleIds = useVisibleIds();
  const obj = useObject(selectedId);

  if (!obj) return null;

  const type = asString(obj.type, "rect");
  const fill = asString(obj.fill, "transparent");
  const stroke = asString(obj.stroke, "#1f2937");
  const strokeWidth = asNumber(obj.strokeWidth, 2);
  const fontSize = asNumber(obj.fontSize, 16);

  const hasFill = type === "rect" || type === "ellipse" || type === "diamond" || type === "sticky";
  const hasFontSize = type === "text" || type === "sticky";

  function allZIndexes(): string[] {
    const keys: string[] = [];
    for (const id of visibleIds) {
      const zReg = client.map.get(id, "zIndex");
      if (typeof zReg?.value === "string") {
        keys.push(zReg.value);
      }
    }
    return keys;
  }

  return (
    <div
      data-testid="property-bar"
      className="pointer-events-auto flex flex-wrap items-center gap-3 rounded-xl border border-neutral-200 bg-white/95 px-3 py-1.5 text-xs text-neutral-700 shadow-md backdrop-blur"
    >
      {hasFill && (
        <div className="flex items-center gap-1">
          <span className="text-[11px] text-neutral-500">Fill</span>
          {FILL_SWATCHES.map((swatch) => (
            <button
              key={swatch}
              type="button"
              aria-label={`Fill ${swatch}`}
              data-testid={`fill-${swatch}`}
              onClick={() =>
                client.mutate([{ objectId: selectedId, field: "fill", value: swatch }])
              }
              className={`h-5 w-5 rounded border ${
                fill === swatch ? "ring-2 ring-blue-500 ring-offset-1" : "border-neutral-300"
              }`}
              style={{
                backgroundColor: swatch === "transparent" ? "#ffffff" : swatch,
                backgroundImage:
                  swatch === "transparent"
                    ? "linear-gradient(45deg, transparent 45%, #ef4444 45%, #ef4444 55%, transparent 55%)"
                    : undefined,
              }}
            />
          ))}
        </div>
      )}

      <div className="flex items-center gap-1">
        <span className="text-[11px] text-neutral-500">{type === "text" ? "Color" : "Stroke"}</span>
        {STROKE_SWATCHES.map((swatch) => (
          <button
            key={swatch}
            type="button"
            aria-label={`Stroke ${swatch}`}
            data-testid={`stroke-${swatch}`}
            onClick={() =>
              client.mutate([{ objectId: selectedId, field: "stroke", value: swatch }])
            }
            className={`h-5 w-5 rounded-full border ${
              stroke === swatch ? "ring-2 ring-blue-500 ring-offset-1" : "border-neutral-300"
            }`}
            style={{ backgroundColor: swatch }}
          />
        ))}
      </div>

      {type !== "text" && (
        <div className="flex items-center gap-1">
          <span className="text-[11px] text-neutral-500">Width</span>
          {STROKE_WIDTHS.map((w) => (
            <button
              key={w}
              type="button"
              onClick={() =>
                client.mutate([{ objectId: selectedId, field: "strokeWidth", value: w }])
              }
              className={`rounded px-1.5 py-0.5 ${
                strokeWidth === w ? "bg-blue-600 text-white" : "bg-neutral-100 hover:bg-neutral-200"
              }`}
            >
              {w}
            </button>
          ))}
        </div>
      )}

      {hasFontSize && (
        <div className="flex items-center gap-1">
          <span className="text-[11px] text-neutral-500">Size</span>
          {FONT_SIZES.map((sz) => (
            <button
              key={sz}
              type="button"
              onClick={() =>
                client.mutate([{ objectId: selectedId, field: "fontSize", value: sz }])
              }
              className={`rounded px-1.5 py-0.5 ${
                fontSize === sz ? "bg-blue-600 text-white" : "bg-neutral-100 hover:bg-neutral-200"
              }`}
            >
              {sz}
            </button>
          ))}
        </div>
      )}

      <div className="h-4 w-px bg-neutral-200" />

      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={() =>
            client.mutate([
              { objectId: selectedId, field: "zIndex", value: bringToFront(allZIndexes()) },
            ])
          }
          className="rounded bg-neutral-100 px-2 py-1 hover:bg-neutral-200"
        >
          Front
        </button>
        <button
          type="button"
          onClick={() =>
            client.mutate([
              { objectId: selectedId, field: "zIndex", value: sendToBack(allZIndexes()) },
            ])
          }
          className="rounded bg-neutral-100 px-2 py-1 hover:bg-neutral-200"
        >
          Back
        </button>
        <button
          type="button"
          data-testid="delete-object"
          onClick={() => {
            client.mutate([{ objectId: selectedId, field: "deleted", value: true }]);
            onDeleted();
          }}
          className="rounded bg-red-50 px-2 py-1 text-red-600 hover:bg-red-100"
        >
          Delete
        </button>
      </div>
    </div>
  );
}
