"use client";

import type { ConnStatus } from "@synccanvas/sync-engine";

export interface PaneHeaderProps {
  label: string;
  accentClass: string;
  status: ConnStatus;
  online: boolean;
  outboxDepth: number;
  stateHash: string;
  latencyMs: number;
  onToggleOnline: () => void;
  onChangeLatency: (ms: number) => void;
}

const LATENCIES = [0, 250, 1000];

export function PaneHeader({
  label,
  accentClass,
  status,
  online,
  outboxDepth,
  stateHash,
  latencyMs,
  onToggleOnline,
  onChangeLatency,
}: PaneHeaderProps) {
  const statusDot =
    status === "online"
      ? "bg-emerald-500"
      : status === "connecting"
        ? "bg-amber-400"
        : "bg-red-500";

  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-neutral-200 bg-white px-3 py-1.5 text-xs">
      <div className="flex items-center gap-2">
        <span className={`inline-block h-2.5 w-2.5 rounded-full ${accentClass}`} />
        <span className="font-semibold text-neutral-900">{label}</span>
        <span className="flex items-center gap-1 rounded-full bg-neutral-100 px-2 py-0.5 text-[11px] text-neutral-600">
          <span className={`h-1.5 w-1.5 rounded-full ${statusDot}`} />
          {status}
        </span>
        {outboxDepth > 0 && (
          <span
            data-testid={`outbox-badge-${label}`}
            className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-800"
          >
            Outbox: {outboxDepth}
          </span>
        )}
      </div>

      <div className="flex items-center gap-2">
        <span
          data-state-hash={stateHash}
          title={stateHash}
          className="hidden font-mono text-[11px] text-neutral-400 sm:inline"
        >
          #{stateHash.slice(0, 8) || "--------"}
        </span>

        <select
          aria-label={`${label} simulated latency`}
          value={latencyMs}
          onChange={(e) => onChangeLatency(Number(e.target.value))}
          className="rounded border border-neutral-200 bg-neutral-50 px-1.5 py-0.5 text-[11px] text-neutral-700"
        >
          {LATENCIES.map((ms) => (
            <option key={ms} value={ms}>
              {ms}ms
            </option>
          ))}
        </select>

        <button
          type="button"
          data-testid={`toggle-network-${label}`}
          onClick={onToggleOnline}
          className={`rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors ${
            online
              ? "bg-red-50 text-red-700 hover:bg-red-100"
              : "bg-emerald-600 text-white hover:bg-emerald-700"
          }`}
        >
          {online ? "Kill Network" : "Reconnect"}
        </button>
      </div>
    </div>
  );
}
