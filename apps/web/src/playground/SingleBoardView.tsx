"use client";

import { colorFromNodeId, createPresenceClient, type RemotePeer } from "@synccanvas/sync-engine";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { WhiteboardCanvas } from "@/canvas/WhiteboardCanvas";
import { SyncProvider, useConnStatus, useOutboxDepth, useSyncClient, useSyncMeta } from "@/sync";

function SingleBoardChrome({ boardId }: { boardId: string }) {
  const client = useSyncClient();
  const { nodeId } = useSyncMeta();
  const status = useConnStatus();
  const outbox = useOutboxDepth();

  const [online, setOnline] = useState(true);
  const [copied, setCopied] = useState(false);
  const [notFound, setNotFound] = useState(false);
  const [toast, setToast] = useState<{ code: string; message: string } | null>(null);
  const [peers, setPeers] = useState<RemotePeer[]>([]);

  const presence = useMemo(
    () =>
      createPresenceClient({
        transport: client.transport,
        clientId: nodeId,
        displayName: `User ${nodeId.slice(-4)}`,
        color: colorFromNodeId(nodeId),
      }),
    [client.transport, nodeId],
  );

  useEffect(() => {
    presence.start();
    const unsubPeers = presence.subscribe(() => setPeers(presence.getPeers()));
    const unsubEvents = client.on((ev) => {
      if (ev.kind === "error") {
        if (ev.code === "BOARD_NOT_FOUND") {
          setNotFound(true);
        } else {
          setToast({ code: ev.code, message: ev.message });
        }
      }
    });
    return () => {
      unsubPeers();
      unsubEvents();
      presence.leave();
      presence.stop();
    };
  }, [client, presence]);

  const handleCursorMove = useCallback(
    (world: { x: number; y: number } | null) => {
      presence.update({ cursor: world });
    },
    [presence],
  );

  const handleSelectionChange = useCallback(
    (selectedId: string | null) => {
      presence.update({ selectedIds: selectedId ? [selectedId] : [] });
    },
    [presence],
  );

  const handleCopyLink = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      setTimeout(() => setCopied(false), 2_000);
    } catch {
      // Ignore in headless environments
    }
  }, []);

  if (notFound) {
    return (
      <div
        data-testid="board-not-found"
        className="flex h-screen flex-col items-center justify-center gap-4 bg-neutral-50 p-6 text-center"
      >
        <h1 className="text-xl font-bold text-neutral-900">Board Not Found</h1>
        <p className="max-w-md text-sm text-neutral-600">
          The board{" "}
          <code className="rounded bg-neutral-200 px-1.5 py-0.5 font-mono">{boardId}</code> does not
          exist or has expired (demo boards expire after 24 hours).
        </p>
        <Link
          href="/"
          className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700"
        >
          Open Split-Screen Playground
        </Link>
      </div>
    );
  }

  const statusDot =
    status === "online"
      ? "bg-emerald-500"
      : status === "connecting"
        ? "bg-amber-400"
        : "bg-red-500";

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-neutral-100">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-neutral-200 bg-white px-4 py-2 text-xs">
        <div className="flex items-center gap-2.5">
          <Link href="/" className="text-sm font-bold text-neutral-950 hover:text-blue-600">
            SyncCanvas
          </Link>
          <span className="rounded bg-neutral-100 px-2 py-0.5 font-mono text-neutral-600">
            {boardId}
          </span>
          <span className="flex items-center gap-1 rounded-full bg-neutral-100 px-2 py-0.5 text-neutral-600">
            <span className={`h-1.5 w-1.5 rounded-full ${statusDot}`} />
            {status}
          </span>
          {outbox > 0 && (
            <span className="rounded-full bg-amber-100 px-2 py-0.5 font-medium text-amber-800">
              Outbox: {outbox}
            </span>
          )}
          {peers.length > 0 && (
            <span className="rounded-full bg-blue-50 px-2 py-0.5 font-medium text-blue-700">
              {peers.length + 1} online
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => {
              const next = !online;
              setOnline(next);
              client.transport.setOnline(next);
            }}
            className={`rounded-md px-2.5 py-1 text-[11px] font-medium ${
              online
                ? "bg-red-50 text-red-700 hover:bg-red-100"
                : "bg-emerald-600 text-white hover:bg-emerald-700"
            }`}
          >
            {online ? "Kill Network" : "Reconnect"}
          </button>
          <button
            type="button"
            onClick={() => void handleCopyLink()}
            className="rounded-lg border border-neutral-200 px-2.5 py-1 font-medium text-neutral-700 hover:bg-neutral-50"
          >
            {copied ? "Copied!" : "Copy Link"}
          </button>
          <Link
            href="/"
            className="rounded-lg border border-neutral-200 px-2.5 py-1 font-medium text-neutral-700 hover:bg-neutral-50"
          >
            Split-Screen Playground
          </Link>
        </div>
      </header>

      {toast !== null && (
        <div
          role="alert"
          className="flex items-center justify-between border-b border-amber-200 bg-amber-50 px-4 py-1.5 text-xs font-medium text-amber-900"
        >
          <span>
            <strong className="font-mono">{toast.code}</strong>: {toast.message}
          </span>
          <button type="button" onClick={() => setToast(null)} className="hover:underline">
            Dismiss
          </button>
        </div>
      )}

      <main className="relative flex-1">
        <WhiteboardCanvas
          presencePeers={peers}
          onCursorMove={handleCursorMove}
          onSelectionChange={handleSelectionChange}
        />
      </main>
    </div>
  );
}

export function SingleBoardView({ boardId }: { boardId: string }) {
  return (
    <SyncProvider boardId={boardId} paneId="single">
      <SingleBoardChrome boardId={boardId} />
    </SyncProvider>
  );
}
