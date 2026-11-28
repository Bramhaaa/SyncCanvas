"use client";

import { useCallback, useRef, useState } from "react";
import {
  clampZoom,
  DEFAULT_VIEWPORT,
  panBy,
  zoomAtPoint,
  type ViewportState,
} from "./viewport-math";

export interface UseViewportResult {
  viewport: ViewportState;
  setViewport: React.Dispatch<React.SetStateAction<ViewportState>>;
  isPanning: boolean;
  isSpacePressed: boolean;
  resetViewport: () => void;
  fitToBounds: (
    bounds: { x: number; y: number; w: number; h: number },
    containerW: number,
    containerH: number,
  ) => void;
  zoomBy: (factor: number, centerX?: number, centerY?: number) => void;
  handleWheel: (e: React.WheelEvent<HTMLElement>) => void;
  handleSpaceKeyDown: (e: React.KeyboardEvent<HTMLElement>) => boolean;
  handleSpaceKeyUp: (e: React.KeyboardEvent<HTMLElement>) => void;
  startPanIfApplicable: (e: React.PointerEvent<HTMLElement>) => boolean;
  movePan: (e: React.PointerEvent<HTMLElement>) => boolean;
  endPan: () => boolean;
}

export function useViewport(initial: ViewportState = DEFAULT_VIEWPORT): UseViewportResult {
  const [viewport, setViewport] = useState<ViewportState>(initial);
  const [isSpacePressed, setIsSpacePressed] = useState(false);
  const [isPanning, setIsPanning] = useState(false);

  const panStartRef = useRef<{ x: number; y: number } | null>(null);

  const handleSpaceKeyDown = useCallback((e: React.KeyboardEvent<HTMLElement>): boolean => {
    if (e.code !== "Space") return false;
    const tag = (e.target as HTMLElement | null)?.tagName;
    if (
      tag === "INPUT" ||
      tag === "TEXTAREA" ||
      (e.target as HTMLElement | null)?.isContentEditable
    ) {
      return false;
    }
    e.preventDefault();
    setIsSpacePressed(true);
    return true;
  }, []);

  const handleSpaceKeyUp = useCallback((e: React.KeyboardEvent<HTMLElement>): void => {
    if (e.code === "Space") {
      setIsSpacePressed(false);
    }
  }, []);

  const resetViewport = useCallback(() => {
    setViewport(DEFAULT_VIEWPORT);
  }, []);

  const fitToBounds = useCallback(
    (
      bounds: { x: number; y: number; w: number; h: number },
      containerW: number,
      containerH: number,
    ) => {
      const padding = 64;
      const availW = Math.max(120, containerW - padding * 2);
      const availH = Math.max(120, containerH - padding * 2);
      const zoom = clampZoom(
        Math.min(availW / Math.max(1, bounds.w), availH / Math.max(1, bounds.h), 1.5),
      );
      const x = containerW / 2 - (bounds.x + bounds.w / 2) * zoom;
      const y = containerH / 2 - (bounds.y + bounds.h / 2) * zoom;
      setViewport({ x, y, zoom });
    },
    [],
  );

  const zoomBy = useCallback((factor: number, centerX = 0, centerY = 0) => {
    setViewport((vp) => zoomAtPoint(vp, vp.zoom * factor, centerX, centerY));
  }, []);

  const handleWheel = useCallback((e: React.WheelEvent<HTMLElement>) => {
    e.preventDefault();
    const rect = e.currentTarget.getBoundingClientRect();
    const screenX = e.clientX - rect.left;
    const screenY = e.clientY - rect.top;
    const zoomFactor = Math.exp(-e.deltaY * 0.0015);
    setViewport((vp) => zoomAtPoint(vp, vp.zoom * zoomFactor, screenX, screenY));
  }, []);

  const startPanIfApplicable = useCallback(
    (e: React.PointerEvent<HTMLElement>): boolean => {
      if (e.button === 1 || (e.button === 0 && isSpacePressed)) {
        panStartRef.current = { x: e.clientX, y: e.clientY };
        setIsPanning(true);
        return true;
      }
      return false;
    },
    [isSpacePressed],
  );

  const movePan = useCallback((e: React.PointerEvent<HTMLElement>): boolean => {
    if (panStartRef.current === null) return false;
    const dx = e.clientX - panStartRef.current.x;
    const dy = e.clientY - panStartRef.current.y;
    panStartRef.current = { x: e.clientX, y: e.clientY };
    setViewport((vp) => panBy(vp, dx, dy));
    return true;
  }, []);

  const endPan = useCallback((): boolean => {
    if (panStartRef.current === null) return false;
    panStartRef.current = null;
    setIsPanning(false);
    return true;
  }, []);

  return {
    viewport,
    setViewport,
    isPanning,
    isSpacePressed,
    resetViewport,
    fitToBounds,
    zoomBy,
    handleWheel,
    handleSpaceKeyDown,
    handleSpaceKeyUp,
    startPanIfApplicable,
    movePan,
    endPan,
  };
}
