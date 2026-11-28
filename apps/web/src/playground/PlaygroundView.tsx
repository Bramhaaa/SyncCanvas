"use client";

import {
  createFakeServer,
  createHlcClock,
  createIndexedDbStorage,
  createMemoryStorage,
  createPresenceClient,
  createSyncClient,
  createWebSocketTransport,
  type PresenceClient,
  type RemotePeer,
  type SyncClient,
} from "@synccanvas/sync-engine";
import { useCallback, useEffect, useRef, useState } from "react";
import { WhiteboardCanvas } from "@/canvas/WhiteboardCanvas";
import { CrdtInspector, type InspectorEntry } from "@/inspector/CrdtInspector";
import { SyncProvider, useConnStatus, useOutboxDepth } from "@/sync";
import { PaneHeader } from "./chaos/ChaosControls";
import { DEMO_RECT_ID, runConflictDemo, seedStarterBoard } from "./chaos/conflict-demo";

interface PaneRuntime {
  client: SyncClient;
  presence: PresenceClient;
}

function PlaygroundPane({
  label,
  accentClass,
  paneId,
  runtime,
  online,
  latencyMs,
  stateHash,
  highlightedId,
  onToggleOnline,
  onChangeLatency,
}: {
  label: string;
  accentClass: string;
  paneId: string;
  runtime: PaneRuntime;
  online: boolean;
  latencyMs: number;
  stateHash: string;
  highlightedId: string | null;
  onToggleOnline: () => void;
  onChangeLatency: (ms: number) => void;
}) {
  const status = useConnStatus();
  const outboxDepth = useOutboxDepth();
  const [peers, setPeers] = useState<RemotePeer[]>([]);

  useEffect(() => {
    const unsub = runtime.presence.subscribe(() => {
      setPeers(runtime.presence.getPeers());
    });
    return unsub;
  }, [runtime.presence]);

  const handleCursorMove = useCallback(
    (world: { x: number; y: number } | null) => {
      runtime.presence.update({ cursor: world });
    },
    [runtime.presence],
  );

  const handleSelectionChange = useCallback(
    (selectedId: string | null) => {
      runtime.presence.update({ selectedIds: selectedId ? [selectedId] : [] });
    },
    [runtime.presence],
  );

  return (
    <div
      data-testid={`pane-${paneId}`}
      data-state-hash={stateHash}
      className="flex min-h-[380px] flex-1 flex-col overflow-hidden border border-neutral-200 bg-white"
    >
      <PaneHeader
        label={label}
        accentClass={accentClass}
        status={status}
        online={online}
        outboxDepth={outboxDepth}
        stateHash={stateHash}
        latencyMs={latencyMs}
        onToggleOnline={onToggleOnline}
        onChangeLatency={onChangeLatency}
      />
      <div className="relative flex-1">
        <WhiteboardCanvas
          presencePeers={peers}
          highlightedId={highlightedId}
          onCursorMove={handleCursorMove}
          onSelectionChange={handleSelectionChange}
        />
      </div>
    </div>
  );
}

export function PlaygroundView() {
  const [boardId, setBoardId] = useState<string>("");
  const [mode, setMode] = useState<"loading" | "backend" | "local">("loading");
  const [backendAwake, setBackendAwake] = useState(false);
  const [bootNonce, setBootNonce] = useState(0);
  const [runtimes, setRuntimes] = useState<{ a: PaneRuntime; b: PaneRuntime } | null>(null);
  const [onlineA, setOnlineA] = useState(true);
  const [onlineB, setOnlineB] = useState(true);
  const [latencyA, setLatencyA] = useState(0);
  const [latencyB, setLatencyB] = useState(0);
  const [hashA, setHashA] = useState("");
  const [hashB, setHashB] = useState("");
  const [outboxA, setOutboxA] = useState(0);
  const [outboxB, setOutboxB] = useState(0);
  const [entries, setEntries] = useState<InspectorEntry[]>([]);
  const [inspectorOpen, setInspectorOpen] = useState(true);
  const [demoRunning, setDemoRunning] = useState(false);
  const [demoCaption, setDemoCaption] = useState<string | null>(null);
  const [fullScreen, setFullScreen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [highlightedId, setHighlightedId] = useState<string | null>(null);
  const [toast, setToast] = useState<{ code: string; message: string } | null>(null);

  const entryIdRef = useRef(0);
  const highlightTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flashObject = useCallback((objectId: string) => {
    setHighlightedId(objectId);
    if (highlightTimerRef.current !== null) clearTimeout(highlightTimerRef.current);
    highlightTimerRef.current = setTimeout(() => {
      setHighlightedId(null);
      highlightTimerRef.current = null;
    }, 2_200);
  }, []);

  const showToast = useCallback((code: string, message: string) => {
    setToast({ code, message });
    if (toastTimerRef.current !== null) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => {
      setToast(null);
      toastTimerRef.current = null;
    }, 4_500);
  }, []);

  useEffect(() => {
    let cancelled = false;
    let cleanupFn: (() => void) | null = null;
    let wakePollTimer: ReturnType<typeof setInterval> | null = null;

    async function boot() {
      const apiUrl = (process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8080").replace(
        /\/$/,
        "",
      );
      const wsUrl = (process.env.NEXT_PUBLIC_WS_URL ?? "ws://localhost:8080").replace(/\/$/, "");

      let resolvedBoardId = "";
      let useBackend = false;

      try {
        const res = await fetch(`${apiUrl}/api/v1/boards`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ title: "Recruiter Playground", isDemo: true }),
          signal: AbortSignal.timeout(4_000),
        });
        if (res.ok) {
          const data = (await res.json()) as { boardId: string };
          resolvedBoardId = data.boardId;
          useBackend = true;
        }
      } catch {
        // Backend unreachable or waking from cold start -> start immediately in local mode
      }

      if (cancelled) return;

      const nodeA = `user_a_${Math.random().toString(36).slice(2, 6)}`;
      const nodeB = `user_b_${Math.random().toString(36).slice(2, 6)}`;

      let clientA: SyncClient;
      let clientB: SyncClient;

      if (useBackend) {
        const storageA = createIndexedDbStorage({
          boardId: resolvedBoardId,
          paneId: "a",
          nodeId: nodeA,
        });
        const storageB = createIndexedDbStorage({
          boardId: resolvedBoardId,
          paneId: "b",
          nodeId: nodeB,
        });
        const transportA = createWebSocketTransport(
          `${wsUrl}/ws/boards/${resolvedBoardId}?clientId=${nodeA}`,
        );
        const transportB = createWebSocketTransport(
          `${wsUrl}/ws/boards/${resolvedBoardId}?clientId=${nodeB}`,
        );
        clientA = createSyncClient({
          boardId: resolvedBoardId,
          nodeId: nodeA,
          storage: storageA,
          transport: transportA,
          clock: createHlcClock({ nodeId: nodeA, now: () => Date.now() }),
          apiBaseUrl: apiUrl,
        });
        clientB = createSyncClient({
          boardId: resolvedBoardId,
          nodeId: nodeB,
          storage: storageB,
          transport: transportB,
          clock: createHlcClock({ nodeId: nodeB, now: () => Date.now() }),
          apiBaseUrl: apiUrl,
        });
      } else {
        resolvedBoardId = `brd_local${Math.random().toString(36).slice(2, 6)}`;
        const fakeServer = createFakeServer();
        clientA = createSyncClient({
          boardId: resolvedBoardId,
          nodeId: nodeA,
          storage: createMemoryStorage({ nodeId: nodeA }),
          transport: fakeServer.createTransport(nodeA),
          clock: createHlcClock({ nodeId: nodeA, now: () => Date.now() }),
          fetchSnapshot: async () => fakeServer.getSnapshot(),
        });
        clientB = createSyncClient({
          boardId: resolvedBoardId,
          nodeId: nodeB,
          storage: createMemoryStorage({ nodeId: nodeB }),
          transport: fakeServer.createTransport(nodeB),
          clock: createHlcClock({ nodeId: nodeB, now: () => Date.now() }),
          fetchSnapshot: async () => fakeServer.getSnapshot(),
        });

        // Quietly poll backend health in case a free-tier PaaS container wakes up from cold start.
        if (process.env.NEXT_PUBLIC_API_URL) {
          wakePollTimer = setInterval(async () => {
            try {
              const r = await fetch(`${apiUrl}/actuator/health`, {
                signal: AbortSignal.timeout(2_500),
              });
              if (r.ok && !cancelled) {
                setBackendAwake(true);
                if (wakePollTimer !== null) {
                  clearInterval(wakePollTimer);
                  wakePollTimer = null;
                }
              }
            } catch {
              // Still waking
            }
          }, 5_000);
        }
      }

      const presenceA = createPresenceClient({
        transport: clientA.transport,
        clientId: nodeA,
        displayName: "User A",
        color: "#2563eb",
      });
      const presenceB = createPresenceClient({
        transport: clientB.transport,
        clientId: nodeB,
        displayName: "User B",
        color: "#db2777",
      });

      const recordEvent = (
        pane: "A" | "B",
        event: Parameters<Parameters<SyncClient["on"]>[0]>[0],
      ) => {
        if (event.kind === "outbox") {
          if (pane === "A") setOutboxA(event.depth);
          else setOutboxB(event.depth);
          return;
        }
        if (event.kind === "status") return;

        if (event.kind === "error") {
          showToast(event.code, event.message);
        } else if (event.kind === "snapshot_required") {
          showToast("SNAPSHOT_REQUIRED", "Op log compacted — merging latest snapshot…");
        }

        const now = new Date();
        const ts = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}:${String(now.getSeconds()).padStart(2, "0")}`;
        entryIdRef.current += 1;
        const entry: InspectorEntry = { id: entryIdRef.current, pane, timestamp: ts, event };
        setEntries((prev) =>
          prev.length >= 250 ? [...prev.slice(-249), entry] : [...prev, entry],
        );

        if (event.kind === "local_op" || event.kind === "remote_op") {
          void clientA.map.stateHash().then(setHashA);
          void clientB.map.stateHash().then(setHashB);
        }
      };

      const unsubA = clientA.on((e) => recordEvent("A", e));
      const unsubB = clientB.on((e) => recordEvent("B", e));

      await Promise.all([clientA.start(), clientB.start()]);
      presenceA.start();
      presenceB.start();

      seedStarterBoard(clientA);
      const [hA, hB] = await Promise.all([clientA.map.stateHash(), clientB.map.stateHash()]);

      if (cancelled) {
        unsubA();
        unsubB();
        presenceA.stop();
        presenceB.stop();
        await Promise.all([clientA.stop(), clientB.stop()]);
        return;
      }

      setBoardId(resolvedBoardId);
      setMode(useBackend ? "backend" : "local");
      setBackendAwake(false);
      setOnlineA(true);
      setOnlineB(true);
      setHashA(hA);
      setHashB(hB);
      setRuntimes({
        a: { client: clientA, presence: presenceA },
        b: { client: clientB, presence: presenceB },
      });

      cleanupFn = () => {
        unsubA();
        unsubB();
        presenceA.stop();
        presenceB.stop();
        void clientA.stop();
        void clientB.stop();
      };
    }

    void boot();
    return () => {
      cancelled = true;
      if (wakePollTimer !== null) clearInterval(wakePollTimer);
      cleanupFn?.();
    };
  }, [bootNonce, showToast]);

  const handleRunDemo = useCallback(async () => {
    if (!runtimes || demoRunning) return;
    setDemoRunning(true);
    setInspectorOpen(true);
    try {
      await runConflictDemo(runtimes.a.client, runtimes.b.client, {
        onCaption: setDemoCaption,
        onOnlineA: setOnlineA,
      });
      flashObject(DEMO_RECT_ID);
      const [hA, hB] = await Promise.all([
        runtimes.a.client.map.stateHash(),
        runtimes.b.client.map.stateHash(),
      ]);
      setHashA(hA);
      setHashB(hB);
    } finally {
      setDemoRunning(false);
    }
  }, [runtimes, demoRunning, flashObject]);

  const handleResetBoard = useCallback(() => {
    if (!runtimes) return;
    const ids = runtimes.a.client.map.visibleObjectIds();
    if (ids.length > 0) {
      runtimes.a.client.mutate(ids.map((id) => ({ objectId: id, field: "deleted", value: true })));
    }
    // Re-seed clean starter shapes
    runtimes.a.client.mutate([
      { objectId: DEMO_RECT_ID, field: "deleted", value: false },
      { objectId: DEMO_RECT_ID, field: "x", value: 80 },
      { objectId: DEMO_RECT_ID, field: "y", value: 110 },
      { objectId: DEMO_RECT_ID, field: "w", value: 150 },
      { objectId: DEMO_RECT_ID, field: "h", value: 95 },
      { objectId: DEMO_RECT_ID, field: "fill", value: "#dbeafe" },
      { objectId: DEMO_RECT_ID, field: "stroke", value: "#2563eb" },
      { objectId: "obj_demo_ellp1", field: "deleted", value: false },
      { objectId: "obj_demo_arrw1", field: "deleted", value: false },
      { objectId: "obj_demo_text1", field: "deleted", value: false },
    ]);
    setDemoCaption(null);
  }, [runtimes]);

  const handleCopyLink = useCallback(async () => {
    if (!boardId || mode !== "backend") return;
    const url = `${window.location.origin}/b/${boardId}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2_000);
    } catch {
      // Fallback ignored in headless browsers
    }
  }, [boardId, mode]);

  if (!runtimes) {
    return (
      <div className="flex h-screen items-center justify-center bg-neutral-50 text-sm text-neutral-500">
        Initializing SyncCanvas CRDT Playground…
      </div>
    );
  }

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-neutral-100">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-neutral-200 bg-white px-4 py-2">
        <div className="flex items-center gap-2.5">
          <h1 className="text-base font-bold tracking-tight text-neutral-950">SyncCanvas</h1>
          <span className="rounded bg-neutral-100 px-2 py-0.5 font-mono text-[11px] text-neutral-600">
            {boardId}
          </span>
          {mode === "local" ? (
            <span className="rounded-full bg-sky-50 px-2.5 py-0.5 text-[11px] font-medium text-sky-700">
              Local Simulation Mode
            </span>
          ) : (
            <span className="rounded-full bg-emerald-50 px-2.5 py-0.5 text-[11px] font-medium text-emerald-700">
              Live Backend Connected
            </span>
          )}
          {mode === "local" && backendAwake && (
            <button
              type="button"
              onClick={() => setBootNonce((n) => n + 1)}
              className="rounded-full bg-emerald-600 px-2.5 py-0.5 text-[11px] font-semibold text-white hover:bg-emerald-700"
            >
              Live server ready — Switch
            </button>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            data-testid="run-conflict-demo"
            disabled={demoRunning}
            onClick={() => void handleRunDemo()}
            className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white shadow-xs transition-colors hover:bg-blue-700 disabled:opacity-50"
          >
            {demoRunning ? "Running Demo…" : "⚡ Run Conflict Demo"}
          </button>

          <button
            type="button"
            data-testid="reset-board"
            onClick={handleResetBoard}
            className="rounded-lg border border-neutral-200 bg-white px-2.5 py-1.5 text-xs font-medium text-neutral-700 hover:bg-neutral-50"
          >
            Reset Board
          </button>

          <button
            type="button"
            onClick={() => setFullScreen((v) => !v)}
            className="rounded-lg border border-neutral-200 bg-white px-2.5 py-1.5 text-xs font-medium text-neutral-700 hover:bg-neutral-50"
          >
            {fullScreen ? "Split Screen" : "Full-Screen A"}
          </button>

          <button
            type="button"
            disabled={mode !== "backend"}
            title={
              mode === "backend"
                ? "Copy shareable multi-tab URL"
                : "Start the backend server to share boards across tabs/devices"
            }
            onClick={() => void handleCopyLink()}
            className="rounded-lg border border-neutral-200 bg-white px-2.5 py-1.5 text-xs font-medium text-neutral-700 hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {copied ? "Copied!" : "Copy Share Link"}
          </button>
        </div>
      </header>

      {toast !== null && (
        <div
          role="alert"
          data-testid="sync-toast"
          className="flex items-center justify-between border-b border-amber-200 bg-amber-50 px-4 py-1.5 text-xs font-medium text-amber-900"
        >
          <span>
            <strong className="font-mono">{toast.code}</strong>: {toast.message}
          </span>
          <button
            type="button"
            onClick={() => setToast(null)}
            className="text-amber-700 hover:underline"
          >
            Dismiss
          </button>
        </div>
      )}

      {demoCaption !== null && (
        <div
          data-testid="demo-caption"
          className="flex items-center justify-between border-b border-blue-200 bg-blue-50 px-4 py-1.5 text-xs font-medium text-blue-900"
        >
          <span>{demoCaption}</span>
          {!demoRunning && (
            <button
              type="button"
              onClick={() => setDemoCaption(null)}
              className="text-blue-700 hover:underline"
            >
              Dismiss
            </button>
          )}
        </div>
      )}

      <main
        className={`grid flex-1 gap-1 overflow-hidden p-1 ${
          fullScreen ? "grid-cols-1" : "grid-cols-1 lg:grid-cols-2"
        }`}
      >
        <SyncProvider boardId={boardId} paneId="a" client={runtimes.a.client} autoStart={false}>
          <PlaygroundPane
            label="User A"
            accentClass="bg-blue-600"
            paneId="a"
            runtime={runtimes.a}
            online={onlineA}
            latencyMs={latencyA}
            stateHash={hashA}
            highlightedId={highlightedId}
            onToggleOnline={() => {
              const next = !onlineA;
              setOnlineA(next);
              runtimes.a.client.transport.setOnline(next);
            }}
            onChangeLatency={(ms) => {
              setLatencyA(ms);
              runtimes.a.client.transport.setLatency(ms);
            }}
          />
        </SyncProvider>

        {!fullScreen && (
          <SyncProvider boardId={boardId} paneId="b" client={runtimes.b.client} autoStart={false}>
            <PlaygroundPane
              label="User B"
              accentClass="bg-pink-600"
              paneId="b"
              runtime={runtimes.b}
              online={onlineB}
              latencyMs={latencyB}
              stateHash={hashB}
              highlightedId={highlightedId}
              onToggleOnline={() => {
                const next = !onlineB;
                setOnlineB(next);
                runtimes.b.client.transport.setOnline(next);
              }}
              onChangeLatency={(ms) => {
                setLatencyB(ms);
                runtimes.b.client.transport.setLatency(ms);
              }}
            />
          </SyncProvider>
        )}
      </main>

      <CrdtInspector
        entries={entries}
        open={inspectorOpen}
        onToggle={() => setInspectorOpen((v) => !v)}
        hashA={hashA}
        hashB={hashB}
        outboxA={outboxA}
        outboxB={outboxB}
        onHighlightObject={flashObject}
      />
    </div>
  );
}
