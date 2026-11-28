"use client";

import type { Tool } from "@/canvas/tools/types";

export interface ToolbarProps {
  activeTool: Tool;
  onSelectTool: (tool: Tool) => void;
  canUndo?: boolean;
  canRedo?: boolean;
  onUndo?: () => void;
  onRedo?: () => void;
  onExportSvg?: () => void;
  onExportPng?: () => void;
}

const TOOLS: Array<{ id: Tool; label: string; shortcut: string }> = [
  { id: "select", label: "Select", shortcut: "V" },
  { id: "rect", label: "Rect", shortcut: "R" },
  { id: "ellipse", label: "Ellipse", shortcut: "O" },
  { id: "diamond", label: "Diamond", shortcut: "D" },
  { id: "sticky", label: "Sticky", shortcut: "S" },
  { id: "arrow", label: "Arrow", shortcut: "A" },
  { id: "freehand", label: "Pen", shortcut: "P" },
  { id: "text", label: "Text", shortcut: "T" },
];

export function Toolbar({
  activeTool,
  onSelectTool,
  canUndo = false,
  canRedo = false,
  onUndo,
  onRedo,
  onExportSvg,
  onExportPng,
}: ToolbarProps) {
  return (
    <div
      role="toolbar"
      aria-label="Drawing tools"
      className="pointer-events-auto flex flex-wrap items-center justify-center gap-0.5 rounded-xl border border-neutral-200 bg-white/95 p-1 shadow-md backdrop-blur"
    >
      {TOOLS.map((tool) => {
        const active = activeTool === tool.id;
        return (
          <button
            key={tool.id}
            type="button"
            data-testid={`tool-${tool.id}`}
            aria-pressed={active}
            title={`${tool.label} (${tool.shortcut})`}
            onClick={() => onSelectTool(tool.id)}
            className={`flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-medium transition-colors ${
              active ? "bg-blue-600 text-white shadow-xs" : "text-neutral-700 hover:bg-neutral-100"
            }`}
          >
            <span>{tool.label}</span>
            <kbd
              className={`hidden rounded px-1 text-[9px] sm:inline ${
                active ? "bg-blue-500 text-blue-50" : "bg-neutral-100 text-neutral-500"
              }`}
            >
              {tool.shortcut}
            </kbd>
          </button>
        );
      })}

      {(onUndo || onRedo) && (
        <>
          <div className="mx-0.5 h-4 w-px bg-neutral-200" />
          <button
            type="button"
            data-testid="undo-button"
            disabled={!canUndo}
            title="Undo (Ctrl/Cmd+Z)"
            onClick={onUndo}
            className="rounded-lg px-2 py-1 text-[11px] font-medium text-neutral-700 hover:bg-neutral-100 disabled:opacity-35"
          >
            ↶
          </button>
          <button
            type="button"
            data-testid="redo-button"
            disabled={!canRedo}
            title="Redo (Ctrl/Cmd+Shift+Z)"
            onClick={onRedo}
            className="rounded-lg px-2 py-1 text-[11px] font-medium text-neutral-700 hover:bg-neutral-100 disabled:opacity-35"
          >
            ↷
          </button>
        </>
      )}

      {(onExportSvg || onExportPng) && (
        <>
          <div className="mx-0.5 h-4 w-px bg-neutral-200" />
          {onExportSvg && (
            <button
              type="button"
              data-testid="export-svg"
              title="Export canvas as SVG"
              onClick={onExportSvg}
              className="rounded-lg px-2 py-1 text-[11px] font-medium text-neutral-600 hover:bg-neutral-100"
            >
              SVG
            </button>
          )}
          {onExportPng && (
            <button
              type="button"
              data-testid="export-png"
              title="Export canvas as PNG"
              onClick={onExportPng}
              className="rounded-lg px-2 py-1 text-[11px] font-medium text-neutral-600 hover:bg-neutral-100"
            >
              PNG
            </button>
          )}
        </>
      )}
    </div>
  );
}
