"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { DEFAULT_VIEWPORT, panBy, zoomAtPoint, type ViewportState } from "./viewport-math";

export interface UseViewportResult {
  viewport: ViewportState;
  setViewport: React.Dispatch<React.SetStateAction<ViewportState>>;
  isPanning: boolean;
  isSpacePressed: boolean;
  resetViewport: () => void;
  zoomBy: (factor: number, centerX?: number, centerY?: number) => void;
  handleWheel: (e: React.WheelEvent<HTMLElement>) => void;
  startPanIfApplicable: (e: React.PointerEvent<HTMLElement>) => boolean;
  movePan: (e: React.PointerEvent<HTMLElement>) => boolean;
  endPan: () => boolean;
}

export function useViewport(initial: ViewportState = DEFAULT_VIEWPORT): UseViewportResult {
  const [viewport, setViewport] = useState<ViewportState>(initial);
  const [isSpacePressed, setIsSpacePressed] = useState(false);
  const [isPanning, setIsPanning] = useState(false);

  const panStartRef = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code !== "Space") return;
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (
        tag === "INPUT" ||
        tag === "TEXTAREA" ||
        (e.target as HTMLElement | null)?.isContentEditable
      ) {
        return;
      }
      e.preventDefault();
      setIsSpacePressed(true);
    };

    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === "Space") {
        setIsSpacePressed(false);
      }
    };

    const onBlur = () => {
      setIsSpacePressed(false);
      panStartRef.current = null;
      setIsPanning(false);
    };

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
    };
  }, []);

  const resetViewport = useCallback(() => {
    setViewport(DEFAULT_VIEWPORT);
  }, []);

  const zoomBy = useCallback((factor: number, centerX = 0, centerY = 0) => {
    setViewport((vp) => zoomAtPoint(vp, vp.zoom * factor, centerX, centerY));
  }, []);

  const handleWheel = useCallback((e: React.WheelEvent<HTMLElement>) => {
    e.preventDefault();
    const rect = e.currentTarget.getBoundingClientRect();
    const screenX = e.clientX - rect.left;
    const screenY = e.clientY - rect.top;
    // Smooth exponential zoom factor from wheel/pinch deltaY
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
    zoomBy,
    handleWheel,
    startPanIfApplicable,
    movePan,
    endPan,
  };
}
