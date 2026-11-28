"use client";

import {
  bringToFront,
  createUndoManager,
  type FieldValue,
  type Op,
  type Point,
  type RemotePeer,
  type UndoFieldDelta,
} from "@synccanvas/sync-engine";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PropertyBar } from "@/components/PropertyBar";
import { Toolbar } from "@/components/Toolbar";
import { useObject, useSyncClient, useVisibleIds } from "@/sync";
import { exportCanvasAsPng, exportCanvasAsSvg } from "./export/export-canvas";
import { normalizeFreehandPoints, pointsToSmoothSvgPath } from "./freehand";
import { RemoteCursorsOverlay, RemoteSelectionOutlines } from "./presence";
import { SelectionOverlay } from "./selection/SelectionOverlay";
import { ShapeNode } from "./shapes/ShapeNode";
import { TextEditorOverlay } from "./text";
import {
  asNumber,
  asString,
  generateObjectId,
  getObjectBounds,
  type ResizeHandle,
  type Tool,
} from "./tools/types";
import { useViewport } from "./useViewport";
import { screenToWorld, type WorldPoint } from "./viewport-math";
import { Viewport } from "./Viewport";

type InteractionState =
  | { kind: "idle" }
  | {
      kind: "creating";
      objectId: string;
      shapeType: "rect" | "ellipse" | "diamond" | "sticky" | "arrow";
      start: WorldPoint;
    }
  | {
      kind: "freehand";
      points: Point[];
    }
  | {
      kind: "moving";
      objectId: string;
      startWorld: WorldPoint;
      origX: number;
      origY: number;
      origX2?: number;
      origY2?: number;
      lastOps: Map<string, Op>;
    }
  | {
      kind: "resizing";
      objectId: string;
      handle: ResizeHandle;
      startWorld: WorldPoint;
      origX: number;
      origY: number;
      origW: number;
      origH: number;
      origX2: number;
      origY2: number;
      lastOps: Map<string, Op>;
    };

export interface WhiteboardCanvasProps {
  /** Optional external callback when selection changes (used by presence / inspector). */
  onSelectionChange?: (selectedId: string | null) => void;
  /** Optional remote peers to render cursors and selection outlines for (T32). */
  presencePeers?: RemotePeer[];
  /** Optional callback receiving world coordinates on pointer move / null on leave (T32). */
  onCursorMove?: (world: WorldPoint | null) => void;
  /** Optional object ID to visually highlight/pulse (from Inspector click or Conflict Demo). */
  highlightedId?: string | null;
}

function HighlightRing({ id, zoom }: { id: string; zoom: number }) {
  const obj = useObject(id);
  if (!obj) return null;
  const bounds = getObjectBounds(obj);
  const inv = 1 / Math.max(0.1, zoom);
  const pad = 8 * inv;

  return (
    <rect
      data-testid={`highlight-${id}`}
      x={bounds.x - pad}
      y={bounds.y - pad}
      width={bounds.w + pad * 2}
      height={bounds.h + pad * 2}
      rx={6 * inv}
      fill="none"
      stroke="#f59e0b"
      strokeWidth={3.5 * inv}
      className="animate-pulse"
      pointerEvents="none"
    />
  );
}

export function WhiteboardCanvas({
  onSelectionChange,
  presencePeers = [],
  onCursorMove,
  highlightedId = null,
}: WhiteboardCanvasProps) {
  const client = useSyncClient();
  const visibleIds = useVisibleIds();
  const vp = useViewport();

  const undoManager = useMemo(() => createUndoManager(client), [client]);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);

  const [tool, setTool] = useState<Tool>("select");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editingTextId, setEditingTextId] = useState<string | null>(null);
  const [freehandPreview, setFreehandPreview] = useState<Point[] | null>(null);

  const interactionRef = useRef<InteractionState>({ kind: "idle" });
  const containerRef = useRef<HTMLDivElement | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);

  useEffect(() => {
    const syncFlags = () => {
      setCanUndo(undoManager.canUndo());
      setCanRedo(undoManager.canRedo());
    };
    syncFlags();
    return undoManager.subscribe(syncFlags);
  }, [undoManager]);

  const updateSelection = useCallback(
    (id: string | null) => {
      setSelectedId(id);
      onSelectionChange?.(id);
    },
    [onSelectionChange],
  );

  // Clear selection if selected object was deleted remotely
  useEffect(() => {
    if (selectedId !== null && !visibleIds.includes(selectedId)) {
      updateSelection(null);
      if (editingTextId === selectedId) {
        setEditingTextId(null);
      }
    }
  }, [selectedId, visibleIds, editingTextId, updateSelection]);

  const nextTopZIndex = useCallback((): string => {
    const keys: string[] = [];
    for (const id of visibleIds) {
      const zReg = client.map.get(id, "zIndex");
      if (typeof zReg?.value === "string") {
        keys.push(zReg.value);
      }
    }
    return bringToFront(keys);
  }, [client, visibleIds]);

  const handleZoomToFit = useCallback(() => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect || visibleIds.length === 0) {
      vp.resetViewport();
      return;
    }
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const id of visibleIds) {
      const obj = client.map.getObject(id);
      if (!obj) continue;
      const b = getObjectBounds(obj);
      if (b.x < minX) minX = b.x;
      if (b.y < minY) minY = b.y;
      if (b.x + b.w > maxX) maxX = b.x + b.w;
      if (b.y + b.h > maxY) maxY = b.y + b.h;
    }
    if (!Number.isFinite(minX)) {
      vp.resetViewport();
      return;
    }
    vp.fitToBounds({ x: minX, y: minY, w: maxX - minX, h: maxY - minY }, rect.width, rect.height);
  }, [client, visibleIds, vp]);

  // Focus-scoped keyboard shortcuts (fixes F4 split-screen keyboard collision!)
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (vp.handleSpaceKeyDown(e)) return;

      const target = e.target as HTMLElement | null;
      if (
        target?.tagName === "INPUT" ||
        target?.tagName === "TEXTAREA" ||
        target?.isContentEditable
      ) {
        return;
      }

      const key = e.key.toLowerCase();
      if ((e.metaKey || e.ctrlKey) && key === "z") {
        e.preventDefault();
        if (e.shiftKey) {
          undoManager.redo();
        } else {
          undoManager.undo();
        }
        return;
      }
      if ((e.metaKey || e.ctrlKey) && key === "y") {
        e.preventDefault();
        undoManager.redo();
        return;
      }

      if (e.metaKey || e.ctrlKey || e.altKey) return;

      if (key === "v") setTool("select");
      else if (key === "r") setTool("rect");
      else if (key === "o") setTool("ellipse");
      else if (key === "d") setTool("diamond");
      else if (key === "s") setTool("sticky");
      else if (key === "a") setTool("arrow");
      else if (key === "p") setTool("freehand");
      else if (key === "t") setTool("text");
      else if (key === "escape") {
        updateSelection(null);
        setEditingTextId(null);
        setTool("select");
      } else if ((key === "delete" || key === "backspace") && selectedId !== null) {
        e.preventDefault();
        undoManager.mutate([{ objectId: selectedId, field: "deleted", value: true }]);
        updateSelection(null);
      }
    },
    [selectedId, undoManager, updateSelection, vp],
  );

  const eventToWorld = useCallback(
    (clientX: number, clientY: number): WorldPoint => {
      const rect = containerRef.current?.getBoundingClientRect();
      const sx = rect ? clientX - rect.left : clientX;
      const sy = rect ? clientY - rect.top : clientY;
      return screenToWorld(sx, sy, vp.viewport);
    },
    [vp.viewport],
  );

  const handleShapePointerDown = useCallback(
    (id: string, e: React.PointerEvent<SVGGElement>) => {
      if (vp.isSpacePressed || e.button !== 0) return;
      if (tool !== "select") return;
      e.stopPropagation();

      // Ensure this pane receives focus for pane-scoped keyboard shortcuts
      (e.currentTarget.closest("[tabindex]") as HTMLElement | null)?.focus({ preventScroll: true });

      updateSelection(id);
      const obj = client.map.getObject(id);
      if (!obj) return;

      const world = eventToWorld(e.clientX, e.clientY);
      interactionRef.current = {
        kind: "moving",
        objectId: id,
        startWorld: world,
        origX: asNumber(obj.x, 0),
        origY: asNumber(obj.y, 0),
        origX2: obj.type === "arrow" ? asNumber(obj.x2, asNumber(obj.x, 0) + 80) : undefined,
        origY2: obj.type === "arrow" ? asNumber(obj.y2, asNumber(obj.y, 0)) : undefined,
        lastOps: new Map(),
      };
    },
    [client, eventToWorld, tool, updateSelection, vp.isSpacePressed],
  );

  const handleShapeDoubleClick = useCallback(
    (id: string, e: React.MouseEvent<SVGGElement>) => {
      e.stopPropagation();
      const obj = client.map.getObject(id);
      if (obj && (obj.type === "text" || obj.type === "sticky")) {
        updateSelection(id);
        setEditingTextId(id);
      }
    },
    [client, updateSelection],
  );

  const handleResizePointerDown = useCallback(
    (handle: ResizeHandle, e: React.PointerEvent<SVGRectElement | SVGCircleElement>) => {
      if (selectedId === null || e.button !== 0) return;
      e.stopPropagation();
      const obj = client.map.getObject(selectedId);
      if (!obj) return;

      const world = eventToWorld(e.clientX, e.clientY);
      interactionRef.current = {
        kind: "resizing",
        objectId: selectedId,
        handle,
        startWorld: world,
        origX: asNumber(obj.x, 0),
        origY: asNumber(obj.y, 0),
        origW: asNumber(obj.w, 100),
        origH: asNumber(obj.h, 80),
        origX2: asNumber(obj.x2, asNumber(obj.x, 0) + 80),
        origY2: asNumber(obj.y2, asNumber(obj.y, 0)),
        lastOps: new Map(),
      };
    },
    [client, eventToWorld, selectedId],
  );

  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      e.currentTarget.focus({ preventScroll: true });

      if (vp.startPanIfApplicable(e)) {
        e.currentTarget.setPointerCapture?.(e.pointerId);
        return;
      }
      if (e.button !== 0) return;

      const world = eventToWorld(e.clientX, e.clientY);

      if (tool === "select") {
        updateSelection(null);
        setEditingTextId(null);
        return;
      }

      if (tool === "text") {
        const objectId = generateObjectId();
        undoManager.mutate([
          { objectId, field: "type", value: "text" },
          { objectId, field: "x", value: Math.round(world.x) },
          { objectId, field: "y", value: Math.round(world.y) },
          { objectId, field: "text", value: "" },
          { objectId, field: "fontSize", value: 18 },
          { objectId, field: "stroke", value: "#1f2937" },
          { objectId, field: "zIndex", value: nextTopZIndex() },
        ]);
        updateSelection(objectId);
        setEditingTextId(objectId);
        setTool("select");
        return;
      }

      if (tool === "freehand") {
        const initial: Point[] = [[world.x, world.y]];
        interactionRef.current = { kind: "freehand", points: initial };
        setFreehandPreview(initial);
        e.currentTarget.setPointerCapture?.(e.pointerId);
        return;
      }

      // rect, ellipse, diamond, sticky, arrow
      const objectId = generateObjectId();
      const baseOps: Array<Omit<Op, "hlc">> = [
        { objectId, field: "type", value: tool },
        { objectId, field: "x", value: Math.round(world.x) },
        { objectId, field: "y", value: Math.round(world.y) },
        { objectId, field: "stroke", value: tool === "sticky" ? "#ca8a04" : "#1f2937" },
        { objectId, field: "strokeWidth", value: 2 },
        { objectId, field: "zIndex", value: nextTopZIndex() },
      ];

      if (tool === "arrow") {
        baseOps.push(
          { objectId, field: "x2", value: Math.round(world.x + 1) },
          { objectId, field: "y2", value: Math.round(world.y + 1) },
          { objectId, field: "arrowHead", value: "end" },
        );
      } else if (tool === "sticky") {
        baseOps.push(
          { objectId, field: "w", value: 160 },
          { objectId, field: "h", value: 120 },
          { objectId, field: "fill", value: "#fef08a" },
          { objectId, field: "text", value: "" },
          { objectId, field: "fontSize", value: 16 },
        );
      } else {
        baseOps.push(
          { objectId, field: "w", value: 1 },
          { objectId, field: "h", value: 1 },
          { objectId, field: "fill", value: tool === "diamond" ? "#f3e8ff" : "#dbeafe" },
        );
      }

      undoManager.mutate(baseOps);
      updateSelection(objectId);

      if (tool === "sticky") {
        setEditingTextId(objectId);
        setTool("select");
        return;
      }

      interactionRef.current = {
        kind: "creating",
        objectId,
        shapeType: tool,
        start: world,
      };
      e.currentTarget.setPointerCapture?.(e.pointerId);
    },
    [eventToWorld, nextTopZIndex, tool, undoManager, updateSelection, vp],
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (onCursorMove) {
        onCursorMove(eventToWorld(e.clientX, e.clientY));
      }
      if (vp.movePan(e)) return;

      const state = interactionRef.current;
      if (state.kind === "idle") return;

      if (state.kind === "freehand") {
        const nativeEvt = e.nativeEvent as PointerEvent;
        const coalesced = nativeEvt.getCoalescedEvents?.() ?? [nativeEvt];
        for (const pe of coalesced) {
          const pt = eventToWorld(pe.clientX, pe.clientY);
          state.points.push([pt.x, pt.y]);
        }
        setFreehandPreview([...state.points]);
        return;
      }

      const world = eventToWorld(e.clientX, e.clientY);

      if (state.kind === "creating") {
        if (state.shapeType === "arrow") {
          client.mutate([
            { objectId: state.objectId, field: "x2", value: Math.round(world.x) },
            { objectId: state.objectId, field: "y2", value: Math.round(world.y) },
          ]);
        } else {
          const x = Math.min(state.start.x, world.x);
          const y = Math.min(state.start.y, world.y);
          const w = Math.max(1, Math.abs(world.x - state.start.x));
          const h = Math.max(1, Math.abs(world.y - state.start.y));
          client.mutate([
            { objectId: state.objectId, field: "x", value: Math.round(x) },
            { objectId: state.objectId, field: "y", value: Math.round(y) },
            { objectId: state.objectId, field: "w", value: Math.round(w) },
            { objectId: state.objectId, field: "h", value: Math.round(h) },
          ]);
        }
        return;
      }

      if (state.kind === "moving") {
        const dx = world.x - state.startWorld.x;
        const dy = world.y - state.startWorld.y;
        const changes: Array<Omit<Op, "hlc">> = [
          { objectId: state.objectId, field: "x", value: Math.round(state.origX + dx) },
          { objectId: state.objectId, field: "y", value: Math.round(state.origY + dy) },
        ];
        if (state.origX2 !== undefined && state.origY2 !== undefined) {
          changes.push(
            { objectId: state.objectId, field: "x2", value: Math.round(state.origX2 + dx) },
            { objectId: state.objectId, field: "y2", value: Math.round(state.origY2 + dy) },
          );
        }
        for (const op of client.mutate(changes)) {
          state.lastOps.set(op.field, op);
        }
        return;
      }

      if (state.kind === "resizing") {
        const dx = world.x - state.startWorld.x;
        const dy = world.y - state.startWorld.y;
        if (state.handle === "start") {
          for (const op of client.mutate([
            { objectId: state.objectId, field: "x", value: Math.round(state.origX + dx) },
            { objectId: state.objectId, field: "y", value: Math.round(state.origY + dy) },
          ])) {
            state.lastOps.set(op.field, op);
          }
          return;
        }
        if (state.handle === "end") {
          for (const op of client.mutate([
            { objectId: state.objectId, field: "x2", value: Math.round(state.origX2 + dx) },
            { objectId: state.objectId, field: "y2", value: Math.round(state.origY2 + dy) },
          ])) {
            state.lastOps.set(op.field, op);
          }
          return;
        }

        let x = state.origX;
        let y = state.origY;
        let w = state.origW;
        let h = state.origH;

        if (state.handle === "se") {
          w = Math.max(12, state.origW + dx);
          h = Math.max(12, state.origH + dy);
        } else if (state.handle === "sw") {
          const nextW = Math.max(12, state.origW - dx);
          x = state.origX + (state.origW - nextW);
          w = nextW;
          h = Math.max(12, state.origH + dy);
        } else if (state.handle === "ne") {
          const nextH = Math.max(12, state.origH - dy);
          y = state.origY + (state.origH - nextH);
          w = Math.max(12, state.origW + dx);
          h = nextH;
        } else if (state.handle === "nw") {
          const nextW = Math.max(12, state.origW - dx);
          const nextH = Math.max(12, state.origH - dy);
          x = state.origX + (state.origW - nextW);
          y = state.origY + (state.origH - nextH);
          w = nextW;
          h = nextH;
        }

        for (const op of client.mutate([
          { objectId: state.objectId, field: "x", value: Math.round(x) },
          { objectId: state.objectId, field: "y", value: Math.round(y) },
          { objectId: state.objectId, field: "w", value: Math.round(w) },
          { objectId: state.objectId, field: "h", value: Math.round(h) },
        ])) {
          state.lastOps.set(op.field, op);
        }
      }
    },
    [client, eventToWorld, onCursorMove, vp],
  );

  const handlePointerUp = useCallback(() => {
    if (vp.endPan()) return;

    const state = interactionRef.current;
    interactionRef.current = { kind: "idle" };

    if (state.kind === "freehand") {
      setFreehandPreview(null);
      if (state.points.length > 0) {
        const { x, y, points } = normalizeFreehandPoints(state.points, vp.viewport.zoom);
        const objectId = generateObjectId();
        undoManager.mutate([
          { objectId, field: "type", value: "freehand" },
          { objectId, field: "x", value: x },
          { objectId, field: "y", value: y },
          { objectId, field: "points", value: points },
          { objectId, field: "stroke", value: "#1f2937" },
          { objectId, field: "strokeWidth", value: 2 },
          { objectId, field: "zIndex", value: nextTopZIndex() },
        ]);
        updateSelection(objectId);
      }
      return;
    }

    if (state.kind === "moving" && state.lastOps.size > 0) {
      const beforeLookup: Record<string, FieldValue | undefined> = {
        x: state.origX,
        y: state.origY,
        x2: state.origX2,
        y2: state.origY2,
      };
      const deltas: UndoFieldDelta[] = [];
      for (const op of state.lastOps.values()) {
        deltas.push({
          objectId: op.objectId,
          field: op.field,
          beforeValue: beforeLookup[op.field],
          afterValue: op.value,
          writtenHlc: op.hlc,
        });
      }
      undoManager.recordTransaction(deltas);
      return;
    }

    if (state.kind === "resizing" && state.lastOps.size > 0) {
      const beforeLookup: Record<string, FieldValue | undefined> = {
        x: state.origX,
        y: state.origY,
        w: state.origW,
        h: state.origH,
        x2: state.origX2,
        y2: state.origY2,
      };
      const deltas: UndoFieldDelta[] = [];
      for (const op of state.lastOps.values()) {
        deltas.push({
          objectId: op.objectId,
          field: op.field,
          beforeValue: beforeLookup[op.field],
          afterValue: op.value,
          writtenHlc: op.hlc,
        });
      }
      undoManager.recordTransaction(deltas);
      return;
    }

    if (state.kind === "creating") {
      const obj = client.map.getObject(state.objectId);
      if (obj && state.shapeType !== "arrow") {
        const w = asNumber(obj.w, 1);
        const h = asNumber(obj.h, 1);
        if (w < 6 && h < 6) {
          client.mutate([
            { objectId: state.objectId, field: "w", value: 120 },
            { objectId: state.objectId, field: "h", value: 80 },
          ]);
        }
      }
      setTool("select");
    }
  }, [client, nextTopZIndex, undoManager, updateSelection, vp]);

  const handlePointerLeave = useCallback(() => {
    onCursorMove?.(null);
  }, [onCursorMove]);

  const editingObj = useObject(editingTextId ?? "");

  return (
    <div ref={containerRef} className="relative h-full w-full">
      <Viewport
        svgRef={svgRef}
        viewport={vp.viewport}
        isPanning={vp.isPanning}
        isSpacePressed={vp.isSpacePressed}
        cursor={tool === "select" ? "default" : "crosshair"}
        onWheel={vp.handleWheel}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onPointerLeave={handlePointerLeave}
        onKeyDown={handleKeyDown}
        onKeyUp={vp.handleSpaceKeyUp}
        overlay={
          <>
            {presencePeers.length > 0 && <RemoteCursorsOverlay peers={presencePeers} />}
            {editingTextId !== null && editingObj !== undefined && (
              <TextEditorOverlay
                x={asNumber(editingObj.x, 0) + (editingObj.type === "sticky" ? 8 : 0)}
                y={asNumber(editingObj.y, 0) + (editingObj.type === "sticky" ? 8 : 0)}
                initialText={asString(editingObj.text, "")}
                fontSize={asNumber(editingObj.fontSize, 16)}
                color={
                  editingObj.type === "sticky" ? "#1f2937" : asString(editingObj.stroke, "#1f2937")
                }
                onCommit={(text) => {
                  undoManager.mutate([{ objectId: editingTextId, field: "text", value: text }]);
                  setEditingTextId(null);
                }}
                onCancel={() => setEditingTextId(null)}
              />
            )}
          </>
        }
        hud={
          <>
            <div className="pointer-events-none absolute left-1/2 top-2.5 z-10 -translate-x-1/2">
              <Toolbar
                activeTool={tool}
                onSelectTool={setTool}
                canUndo={canUndo}
                canRedo={canRedo}
                onUndo={() => undoManager.undo()}
                onRedo={() => undoManager.redo()}
                onExportSvg={() => exportCanvasAsSvg(svgRef.current)}
                onExportPng={() => exportCanvasAsPng(svgRef.current)}
              />
            </div>

            {selectedId !== null && (
              <div className="pointer-events-none absolute bottom-3 left-3 z-10 max-w-[calc(100%-10rem)]">
                <PropertyBar
                  selectedId={selectedId}
                  onMutate={(changes) => undoManager.mutate(changes)}
                  onDeleted={() => updateSelection(null)}
                />
              </div>
            )}

            <div className="pointer-events-auto absolute bottom-3 right-3 z-10 flex items-center gap-1 rounded-lg border border-neutral-200 bg-white/95 px-2 py-1 text-xs text-neutral-700 shadow-sm">
              <button
                type="button"
                onClick={handleZoomToFit}
                className="rounded px-1.5 text-[11px] hover:bg-neutral-100"
                title="Fit all shapes in view"
              >
                Fit
              </button>
              <div className="h-3.5 w-px bg-neutral-200" />
              <button
                type="button"
                onClick={() => vp.zoomBy(0.8)}
                className="rounded px-1.5 hover:bg-neutral-100"
                aria-label="Zoom out"
              >
                −
              </button>
              <button
                type="button"
                onClick={vp.resetViewport}
                className="min-w-[3.2rem] rounded px-1 text-center font-mono hover:bg-neutral-100"
                title="Reset zoom"
              >
                {Math.round(vp.viewport.zoom * 100)}%
              </button>
              <button
                type="button"
                onClick={() => vp.zoomBy(1.25)}
                className="rounded px-1.5 hover:bg-neutral-100"
                aria-label="Zoom in"
              >
                +
              </button>
            </div>
          </>
        }
      >
        {visibleIds.map((id) => (
          <ShapeNode
            key={id}
            id={id}
            isEditing={editingTextId === id}
            onPointerDown={handleShapePointerDown}
            onDoubleClick={handleShapeDoubleClick}
          />
        ))}

        {freehandPreview !== null && (
          <path
            d={pointsToSmoothSvgPath(freehandPreview)}
            fill="none"
            stroke="#1f2937"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            pointerEvents="none"
          />
        )}

        {highlightedId !== null && <HighlightRing id={highlightedId} zoom={vp.viewport.zoom} />}

        {presencePeers.length > 0 && (
          <RemoteSelectionOutlines peers={presencePeers} zoom={vp.viewport.zoom} />
        )}

        {selectedId !== null && (
          <SelectionOverlay
            selectedId={selectedId}
            zoom={vp.viewport.zoom}
            onHandlePointerDown={handleResizePointerDown}
          />
        )}
      </Viewport>
    </div>
  );
}
