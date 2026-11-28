"use client";

import type { SyncEvent } from "@synccanvas/sync-engine";
import { useMemo, useState } from "react";

export interface InspectorEntry {
  id: number;
  pane: "A" | "B";
  timestamp: string;
  event: SyncEvent;
}

export interface CrdtInspectorProps {
  entries: InspectorEntry[];
  open: boolean;
  onToggle: () => void;
  hashA: string;
  hashB: string;
  outboxA: number;
  outboxB: number;
  onHighlightObject?: (objectId: string) => void;
}

function HlcBadge({ hlc }: { hlc: string }) {
  const parts = hlc.split(":");
  if (parts.length !== 3) {
    return <span className="font-mono text-[11px] text-neutral-600">{hlc}</span>;
  }
  return (
    <span className="font-mono text-[11px]">
      <span className="text-sky-700">{parts[0]!.slice(-6)}</span>
      <span className="text-neutral-400">:</span>
      <span className="text-violet-700">{parts[1]}</span>
      <span className="text-neutral-400">:</span>
      <span className="text-emerald-700">{parts[2]}</span>
    </span>
  );
}

function formatValue(val: unknown): string {
  const raw = JSON.stringify(val);
  return raw.length > 36 ? `${raw.slice(0, 33)}…` : raw;
}

export function CrdtInspector({
  entries,
  open,
  onToggle,
  hashA,
  hashB,
  outboxA,
  outboxB,
  onHighlightObject,
}: CrdtInspectorProps) {
  const [paneFilter, setPaneFilter] = useState<"ALL" | "A" | "B">("ALL");
  const [objectFilter, setObjectFilter] = useState("");

  const filtered = useMemo(() => {
    const query = objectFilter.trim().toLowerCase();
    return entries
      .filter((entry) => {
        if (paneFilter !== "ALL" && entry.pane !== paneFilter) return false;
        if (!query) return true;
        if (entry.event.kind === "local_op" || entry.event.kind === "remote_op") {
          return (
            entry.event.op.objectId.toLowerCase().includes(query) ||
            entry.event.op.field.toLowerCase().includes(query)
          );
        }
        return entry.event.kind.includes(query);
      })
      .slice(-150)
      .reverse();
  }, [entries, paneFilter, objectFilter]);

  const hashesMatch = hashA.length > 0 && hashA === hashB;

  return (
    <section
      data-testid="crdt-inspector"
      className="border-t border-neutral-200 bg-white text-xs text-neutral-800"
    >
      <div className="flex flex-wrap items-center justify-between gap-2 bg-neutral-50 px-3 py-1.5">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onToggle}
            className="font-semibold text-neutral-800 hover:text-blue-600"
          >
            {open ? "▾" : "▸"} CRDT Merge Inspector ({entries.length})
          </button>

          <span
            data-testid="convergence-badge"
            className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
              hashesMatch ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-800"
            }`}
          >
            {hashesMatch ? "✓ Converged" : "⟳ Diverged / Syncing"}
          </span>

          <span className="font-mono text-[11px] text-neutral-500">
            A: {hashA.slice(0, 8) || "--------"} (outbox {outboxA})
          </span>
          <span className="font-mono text-[11px] text-neutral-500">
            B: {hashB.slice(0, 8) || "--------"} (outbox {outboxB})
          </span>
        </div>

        {open && (
          <div className="flex items-center gap-2">
            <div className="flex overflow-hidden rounded border border-neutral-200 bg-white">
              {(["ALL", "A", "B"] as const).map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => setPaneFilter(p)}
                  className={`px-2 py-0.5 text-[11px] ${
                    paneFilter === p
                      ? "bg-blue-600 text-white"
                      : "text-neutral-600 hover:bg-neutral-100"
                  }`}
                >
                  {p}
                </button>
              ))}
            </div>
            <input
              type="text"
              value={objectFilter}
              onChange={(e) => setObjectFilter(e.target.value)}
              placeholder="Filter objectId / field…"
              className="rounded border border-neutral-200 px-2 py-0.5 text-[11px] outline-none focus:border-blue-500"
            />
          </div>
        )}
      </div>

      {open && (
        <div className="max-h-52 overflow-auto">
          <table className="w-full border-collapse text-left">
            <thead className="sticky top-0 bg-neutral-100 text-[11px] text-neutral-500">
              <tr>
                <th className="px-2 py-1 font-medium">Time</th>
                <th className="px-2 py-1 font-medium">Pane</th>
                <th className="px-2 py-1 font-medium">Dir</th>
                <th className="px-2 py-1 font-medium">Target</th>
                <th className="px-2 py-1 font-medium">Value</th>
                <th className="px-2 py-1 font-medium">HLC (ms:cnt:node)</th>
                <th className="px-2 py-1 font-medium">Seq</th>
                <th className="px-2 py-1 font-medium">Result</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100">
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-3 py-4 text-center text-neutral-400">
                    Draw on either canvas or run the Conflict Demo to inspect CRDT operations.
                  </td>
                </tr>
              ) : (
                filtered.map((row) => {
                  const ev = row.event;
                  if (ev.kind === "local_op") {
                    return (
                      <tr
                        key={row.id}
                        onClick={() => onHighlightObject?.(ev.op.objectId)}
                        title="Click to highlight object on canvas"
                        className="cursor-pointer hover:bg-amber-50/70"
                      >
                        <td className="px-2 py-1 font-mono text-[11px] text-neutral-400">
                          {row.timestamp}
                        </td>
                        <td className="px-2 py-1 font-semibold">{row.pane}</td>
                        <td className="px-2 py-1 text-blue-600">● local</td>
                        <td className="px-2 py-1 font-mono">
                          {ev.op.objectId}.{ev.op.field}
                        </td>
                        <td className="px-2 py-1 font-mono text-neutral-600">
                          {formatValue(ev.op.value)}
                        </td>
                        <td className="px-2 py-1">
                          <HlcBadge hlc={ev.op.hlc} />
                        </td>
                        <td className="px-2 py-1 font-mono text-neutral-400">—</td>
                        <td className="px-2 py-1">
                          <span className="rounded bg-blue-50 px-1.5 py-0.5 text-[10px] font-medium text-blue-700">
                            LOCAL
                          </span>
                        </td>
                      </tr>
                    );
                  }
                  if (ev.kind === "remote_op") {
                    const accepted = ev.result.status === "ACCEPTED";
                    return (
                      <tr
                        key={row.id}
                        onClick={() => onHighlightObject?.(ev.op.objectId)}
                        title="Click to highlight object on canvas"
                        className="cursor-pointer hover:bg-amber-50/70"
                      >
                        <td className="px-2 py-1 font-mono text-[11px] text-neutral-400">
                          {row.timestamp}
                        </td>
                        <td className="px-2 py-1 font-semibold">{row.pane}</td>
                        <td className="px-2 py-1 text-emerald-600">↓ recv</td>
                        <td className="px-2 py-1 font-mono">
                          {ev.op.objectId}.{ev.op.field}
                        </td>
                        <td className="px-2 py-1 font-mono text-neutral-600">
                          {formatValue(ev.op.value)}
                        </td>
                        <td className="px-2 py-1">
                          <HlcBadge hlc={ev.op.hlc} />
                        </td>
                        <td className="px-2 py-1 font-mono">{ev.seq}</td>
                        <td className="px-2 py-1">
                          <span
                            title={
                              ev.result.status === "ACCEPTED"
                                ? "Applied to LWW-Map"
                                : ev.result.reason
                            }
                            className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${
                              accepted
                                ? "bg-emerald-100 text-emerald-800"
                                : "bg-amber-100 text-amber-800"
                            }`}
                          >
                            {ev.result.status}
                          </span>
                        </td>
                      </tr>
                    );
                  }
                  if (ev.kind === "sent") {
                    return (
                      <tr key={row.id} className="hover:bg-neutral-50">
                        <td className="px-2 py-1 font-mono text-[11px] text-neutral-400">
                          {row.timestamp}
                        </td>
                        <td className="px-2 py-1 font-semibold">{row.pane}</td>
                        <td className="px-2 py-1 text-indigo-600">↑ sent</td>
                        <td colSpan={4} className="px-2 py-1 text-neutral-600">
                          SYNC_PUSH ({ev.ops.length} op{ev.ops.length === 1 ? "" : "s"})
                        </td>
                        <td className="px-2 py-1 text-[10px] text-neutral-400">PUSH</td>
                      </tr>
                    );
                  }
                  if (ev.kind === "acked") {
                    return (
                      <tr key={row.id} className="hover:bg-neutral-50">
                        <td className="px-2 py-1 font-mono text-[11px] text-neutral-400">
                          {row.timestamp}
                        </td>
                        <td className="px-2 py-1 font-semibold">{row.pane}</td>
                        <td className="px-2 py-1 text-emerald-700">✓ ack</td>
                        <td colSpan={3} className="px-2 py-1 text-neutral-600">
                          Cleared {ev.hlcs.length} outbox op{ev.hlcs.length === 1 ? "" : "s"}
                        </td>
                        <td className="px-2 py-1 font-mono">{ev.seq}</td>
                        <td className="px-2 py-1 text-[10px] text-emerald-700">ACKED</td>
                      </tr>
                    );
                  }
                  return (
                    <tr key={row.id} className="hover:bg-neutral-50">
                      <td className="px-2 py-1 font-mono text-[11px] text-neutral-400">
                        {row.timestamp}
                      </td>
                      <td className="px-2 py-1 font-semibold">{row.pane}</td>
                      <td className="px-2 py-1 text-amber-600">⚡ {ev.kind}</td>
                      <td colSpan={5} className="px-2 py-1 font-mono text-neutral-600">
                        {formatValue(ev)}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
