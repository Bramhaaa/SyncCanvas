"use client";

import Link from "next/link";
import { WhiteboardCanvas } from "@/canvas/WhiteboardCanvas";
import { SyncProvider, useConnStatus, useOutboxDepth } from "@/sync";

function SingleBoardChrome({ boardId }: { boardId: string }) {
  const status = useConnStatus();
  const outbox = useOutboxDepth();

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-neutral-100">
      <header className="flex items-center justify-between border-b border-neutral-200 bg-white px-4 py-2 text-xs">
        <div className="flex items-center gap-3">
          <Link href="/" className="text-sm font-bold text-neutral-950 hover:text-blue-600">
            SyncCanvas
          </Link>
          <span className="rounded bg-neutral-100 px-2 py-0.5 font-mono text-neutral-600">
            {boardId}
          </span>
          <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-neutral-600">
            {status} {outbox > 0 ? `· ${outbox} queued` : ""}
          </span>
        </div>
        <Link
          href="/"
          className="rounded-lg border border-neutral-200 px-2.5 py-1 font-medium text-neutral-700 hover:bg-neutral-50"
        >
          Open Split-Screen Playground
        </Link>
      </header>
      <main className="relative flex-1">
        <WhiteboardCanvas />
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
