"use client";

import {
  createFakeServer,
  createHlcClock,
  createMemoryStorage,
  createSyncClient,
  type SyncClient,
} from "@synccanvas/sync-engine";
import { useCallback, useState } from "react";
import { WhiteboardCanvas } from "@/canvas/WhiteboardCanvas";
import { SyncProvider } from "@/sync";

interface LatencyStats {
  samples: number;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
}

interface RenderStats {
  objectCount: number;
  frames: number;
  under16msPct: number;
  p50FrameMs: number;
  p95FrameMs: number;
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx]!;
}

export function BenchView() {
  const [latencyStats, setLatencyStats] = useState<LatencyStats | null>(null);
  const [renderStats, setRenderStats] = useState<RenderStats | null>(null);
  const [renderClient, setRenderClient] = useState<SyncClient | null>(null);
  const [running, setRunning] = useState(false);

  const runLatencyBench = useCallback(async () => {
    setRunning(true);
    try {
      const server = createFakeServer();
      const clientA = createSyncClient({
        boardId: "brd_bench001",
        nodeId: "bench_a",
        storage: createMemoryStorage({ nodeId: "bench_a" }),
        transport: server.createTransport("bench_a"),
        clock: createHlcClock({ nodeId: "bench_a", now: () => Date.now() }),
        flushIntervalMs: 0,
        fetchSnapshot: async () => server.getSnapshot(),
      });
      const clientB = createSyncClient({
        boardId: "brd_bench001",
        nodeId: "bench_b",
        storage: createMemoryStorage({ nodeId: "bench_b" }),
        transport: server.createTransport("bench_b"),
        clock: createHlcClock({ nodeId: "bench_b", now: () => Date.now() }),
        flushIntervalMs: 0,
        fetchSnapshot: async () => server.getSnapshot(),
      });

      await Promise.all([clientA.start(), clientB.start()]);
      clientA.mutate([
        { objectId: "obj_bench001", field: "type", value: "rect" },
        { objectId: "obj_bench001", field: "x", value: 0 },
      ]);

      const latencies: number[] = [];
      let pendingStart = 0;
      let resolver: (() => void) | null = null;

      const unsub = clientB.on((ev) => {
        if (ev.kind === "remote_op" && ev.op.objectId === "obj_bench001" && ev.op.field === "x") {
          latencies.push(performance.now() - pendingStart);
          resolver?.();
        }
      });

      for (let i = 1; i <= 500; i++) {
        await new Promise<void>((resolve) => {
          resolver = resolve;
          pendingStart = performance.now();
          clientA.mutate([{ objectId: "obj_bench001", field: "x", value: i }]);
        });
      }

      unsub();
      await Promise.all([clientA.stop(), clientB.stop()]);

      const sorted = [...latencies].sort((a, b) => a - b);
      setLatencyStats({
        samples: sorted.length,
        p50Ms: Number(percentile(sorted, 50).toFixed(2)),
        p95Ms: Number(percentile(sorted, 95).toFixed(2)),
        p99Ms: Number(percentile(sorted, 99).toFixed(2)),
      });
    } finally {
      setRunning(false);
    }
  }, []);

  const runRenderBench = useCallback(async () => {
    setRunning(true);
    try {
      const server = createFakeServer();
      const client = createSyncClient({
        boardId: "brd_render01",
        nodeId: "bench_r",
        storage: createMemoryStorage({ nodeId: "bench_r" }),
        transport: server.createTransport("bench_r"),
        clock: createHlcClock({ nodeId: "bench_r", now: () => Date.now() }),
        flushIntervalMs: 40,
        fetchSnapshot: async () => server.getSnapshot(),
      });
      await client.start();

      // Seed 1,000 objects in a 40x25 grid
      const batch = [];
      for (let i = 0; i < 1000; i++) {
        const id = `obj_r${String(i).padStart(5, "0")}`;
        batch.push(
          { objectId: id, field: "type", value: "rect" },
          { objectId: id, field: "x", value: (i % 40) * 32 },
          { objectId: id, field: "y", value: Math.floor(i / 40) * 28 },
          { objectId: id, field: "w", value: 24 },
          { objectId: id, field: "h", value: 20 },
          { objectId: id, field: "fill", value: i === 0 ? "#2563eb" : "#e5e7eb" },
          { objectId: id, field: "zIndex", value: `a${String(i).padStart(4, "0")}` },
        );
      }
      client.mutate(batch);
      setRenderClient(client);

      // Wait two animation frames for initial mount, then drag obj_r00000 across 60 frames
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

      const deltas: number[] = [];
      let prev = performance.now();
      for (let frame = 0; frame < 60; frame++) {
        await new Promise<void>((resolve) => {
          requestAnimationFrame((now) => {
            deltas.push(now - prev);
            prev = now;
            client.mutate([
              { objectId: "obj_r00000", field: "x", value: frame * 8 },
              { objectId: "obj_r00000", field: "y", value: frame * 4 },
            ]);
            resolve();
          });
        });
      }

      const sorted = [...deltas].sort((a, b) => a - b);
      const under16 = sorted.filter((d) => d <= 16.7).length;
      setRenderStats({
        objectCount: 1000,
        frames: sorted.length,
        under16msPct: Number(((under16 / sorted.length) * 100).toFixed(1)),
        p50FrameMs: Number(percentile(sorted, 50).toFixed(2)),
        p95FrameMs: Number(percentile(sorted, 95).toFixed(2)),
      });
    } finally {
      setRunning(false);
    }
  }, []);

  return (
    <div className="flex min-h-screen flex-col gap-4 bg-neutral-50 p-6 text-sm text-neutral-900">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold">SyncCanvas Performance Benchmark Harness</h1>
          <p className="text-xs text-neutral-500">
            Measures A↔B CRDT sync round-trip latency (500 ops) and 1,000-object single-shape drag
            frame times.
          </p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            disabled={running}
            onClick={() => void runLatencyBench()}
            className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
          >
            Run 500-Op Sync Latency
          </button>
          <button
            type="button"
            disabled={running}
            onClick={() => void runRenderBench()}
            className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
          >
            Run 1,000-Object Render Bench
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div className="rounded-xl border border-neutral-200 bg-white p-4">
          <h2 className="font-semibold">A↔B Sync Latency (500 mutations)</h2>
          {latencyStats ? (
            <dl className="mt-2 grid grid-cols-3 gap-2 font-mono text-xs">
              <div>
                <dt className="text-neutral-400">p50</dt>
                <dd className="text-base font-bold">{latencyStats.p50Ms} ms</dd>
              </div>
              <div>
                <dt className="text-neutral-400">p95</dt>
                <dd className="text-base font-bold">{latencyStats.p95Ms} ms</dd>
              </div>
              <div>
                <dt className="text-neutral-400">p99</dt>
                <dd className="text-base font-bold">{latencyStats.p99Ms} ms</dd>
              </div>
            </dl>
          ) : (
            <p className="mt-2 text-xs text-neutral-400">
              Click &ldquo;Run 500-Op Sync Latency&rdquo; to measure.
            </p>
          )}
        </div>

        <div className="rounded-xl border border-neutral-200 bg-white p-4">
          <h2 className="font-semibold">1,000-Object Drag Frame Times (60 frames)</h2>
          {renderStats ? (
            <dl className="mt-2 grid grid-cols-3 gap-2 font-mono text-xs">
              <div>
                <dt className="text-neutral-400">&lt; 16.7ms</dt>
                <dd className="text-base font-bold text-emerald-700">
                  {renderStats.under16msPct}%
                </dd>
              </div>
              <div>
                <dt className="text-neutral-400">p50 frame</dt>
                <dd className="text-base font-bold">{renderStats.p50FrameMs} ms</dd>
              </div>
              <div>
                <dt className="text-neutral-400">p95 frame</dt>
                <dd className="text-base font-bold">{renderStats.p95FrameMs} ms</dd>
              </div>
            </dl>
          ) : (
            <p className="mt-2 text-xs text-neutral-400">
              Click &ldquo;Run 1,000-Object Render Bench&rdquo; to measure.
            </p>
          )}
        </div>
      </div>

      {renderClient && (
        <div className="h-[460px] overflow-hidden rounded-xl border border-neutral-200 bg-white">
          <SyncProvider
            boardId="brd_render01"
            paneId="bench"
            client={renderClient}
            autoStart={false}
          >
            <WhiteboardCanvas />
          </SyncProvider>
        </div>
      )}
    </div>
  );
}
