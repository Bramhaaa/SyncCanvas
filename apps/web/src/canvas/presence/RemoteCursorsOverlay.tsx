"use client";

import type { RemotePeer } from "@synccanvas/sync-engine";
import { useObject } from "@/sync";
import { getObjectBounds } from "../tools/types";

export interface RemoteCursorsOverlayProps {
  peers: RemotePeer[];
}

export function RemoteCursorsOverlay({ peers }: RemoteCursorsOverlayProps) {
  return (
    <>
      {peers.map((peer) => {
        if (!peer.cursor) return null;
        return (
          <div
            key={peer.clientId}
            data-testid={`remote-cursor-${peer.clientId}`}
            className="pointer-events-none absolute left-0 top-0 transition-transform duration-75 ease-linear"
            style={{
              transform: `translate(${peer.cursor.x}px, ${peer.cursor.y}px)`,
            }}
          >
            <svg
              width="18"
              height="18"
              viewBox="0 0 18 18"
              className="-ml-0.5 -mt-0.5 drop-shadow-xs"
            >
              <path
                d="M2 2L15 8.5L9.2 10.2L7.5 16L2 2Z"
                fill={peer.color}
                stroke="#ffffff"
                strokeWidth="1.5"
                strokeLinejoin="round"
              />
            </svg>
            <div
              className="ml-3 -mt-1 inline-block whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-medium text-white shadow-xs"
              style={{ backgroundColor: peer.color }}
            >
              {peer.displayName}
            </div>
          </div>
        );
      })}
    </>
  );
}

function RemoteSelectionBox({
  objectId,
  color,
  displayName,
  zoom,
}: {
  objectId: string;
  color: string;
  displayName: string;
  zoom: number;
}) {
  const obj = useObject(objectId);
  if (!obj) return null;
  const bounds = getObjectBounds(obj);
  const inv = 1 / Math.max(0.1, zoom);
  const pad = 4 * inv;

  return (
    <g pointerEvents="none">
      <rect
        x={bounds.x - pad}
        y={bounds.y - pad}
        width={bounds.w + pad * 2}
        height={bounds.h + pad * 2}
        fill="none"
        stroke={color}
        strokeWidth={2 * inv}
        rx={2 * inv}
      />
      <text
        x={bounds.x - pad}
        y={bounds.y - pad - 4 * inv}
        fill={color}
        fontSize={11 * inv}
        fontWeight={600}
        fontFamily="system-ui, sans-serif"
      >
        {displayName}
      </text>
    </g>
  );
}

export function RemoteSelectionOutlines({ peers, zoom }: { peers: RemotePeer[]; zoom: number }) {
  return (
    <>
      {peers.flatMap((peer) =>
        peer.selectedIds.map((objectId) => (
          <RemoteSelectionBox
            key={`${peer.clientId}:${objectId}`}
            objectId={objectId}
            color={peer.color}
            displayName={peer.displayName}
            zoom={zoom}
          />
        )),
      )}
    </>
  );
}
