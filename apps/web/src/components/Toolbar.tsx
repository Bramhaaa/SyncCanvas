"use client";

import type { Tool } from "@/canvas/tools/types";

export interface ToolbarProps {
  activeTool: Tool;
  onSelectTool: (tool: Tool) => void;
}

const TOOLS: Array<{ id: Tool; label: string; shortcut: string }> = [
  { id: "select", label: "Select", shortcut: "V" },
  { id: "rect", label: "Rect", shortcut: "R" },
  { id: "ellipse", label: "Ellipse", shortcut: "O" },
  { id: "arrow", label: "Arrow", shortcut: "A" },
  { id: "freehand", label: "Pen", shortcut: "P" },
  { id: "text", label: "Text", shortcut: "T" },
];

export function Toolbar({ activeTool, onSelectTool }: ToolbarProps) {
  return (
    <div
      role="toolbar"
      aria-label="Drawing tools"
      className="pointer-events-auto flex items-center gap-1 rounded-xl border border-neutral-200 bg-white/95 p-1 shadow-md backdrop-blur"
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
            className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors ${
              active ? "bg-blue-600 text-white shadow-xs" : "text-neutral-700 hover:bg-neutral-100"
            }`}
          >
            <span>{tool.label}</span>
            <kbd
              className={`rounded px-1 text-[10px] ${
                active ? "bg-blue-500 text-blue-50" : "bg-neutral-100 text-neutral-500"
              }`}
            >
              {tool.shortcut}
            </kbd>
          </button>
        );
      })}
    </div>
  );
}
