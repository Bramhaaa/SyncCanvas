import { execSync } from "node:child_process";
import {
  createHlcClock,
  createLwwMap,
  createMemoryStorage,
  createSyncClient,
  createWebSocketTransport,
} from "../../packages/sync-engine/src/index.ts";

const API_URL = process.env.API_URL ?? "http://localhost:8080";
const SERVER1_WS = process.env.SERVER1_WS ?? "ws://localhost:8081";
const SERVER2_WS = process.env.SERVER2_WS ?? "ws://localhost:8082";
const DURATION_MS = Number(process.env.CHAOS_DURATION_MS ?? "30000");
const SKIP_REDIS_RESTART = process.env.SKIP_REDIS_RESTART === "1";

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function createBoard() {
  const res = await fetch(`${API_URL}/api/v1/boards`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ title: "Multinode Chaos IT", isDemo: true }),
  });
  if (!res.ok) {
    throw new Error(`POST /api/v1/boards failed: HTTP ${res.status} ${await res.text()}`);
  }
  const data = await res.json();
  return data.boardId;
}

async function fetchSnapshotHash(boardId) {
  const res = await fetch(`${API_URL}/api/v1/boards/${boardId}/snapshot`);
  if (!res.ok) {
    throw new Error(`GET /snapshot failed: HTTP ${res.status}`);
  }
  const { state, snapshotSeq } = await res.json();
  const map = createLwwMap(state);
  return { hash: await map.stateHash(), snapshotSeq };
}

async function main() {
  const boardId = await createBoard();
  console.log(
    `[chaos] Created board ${boardId}; spinning up 6 clients (3 on server1, 3 on server2)`,
  );

  const clients = [];
  for (let i = 0; i < 6; i++) {
    const nodeId = `chaos_node_${i}`;
    const wsBase = i < 3 ? SERVER1_WS : SERVER2_WS;
    const storage = createMemoryStorage({ nodeId });
    const clock = createHlcClock({ nodeId, now: () => Date.now() });
    const transport = createWebSocketTransport(`${wsBase}/ws/boards/${boardId}?clientId=${nodeId}`);
    const client = createSyncClient({
      boardId,
      nodeId,
      storage,
      transport,
      clock,
      apiBaseUrl: API_URL,
      flushIntervalMs: 30,
    });
    await client.start();
    clients.push({ nodeId, client, storage, online: true });
  }

  // Wait for initial connections
  await sleep(1000);

  // Seed 8 objects from client 0
  for (let o = 0; o < 8; o++) {
    clients[0].client.mutate([
      { objectId: `obj_seed00000${o}`, field: "type", value: "rect" },
      { objectId: `obj_seed00000${o}`, field: "x", value: o * 40 },
      { objectId: `obj_seed00000${o}`, field: "y", value: o * 20 },
      { objectId: `obj_seed00000${o}`, field: "w", value: 80 },
      { objectId: `obj_seed00000${o}`, field: "h", value: 60 },
      { objectId: `obj_seed00000${o}`, field: "fill", value: "#dbeafe" },
      { objectId: `obj_seed00000${o}`, field: "zIndex", value: `a${o}` },
    ]);
  }

  const startTime = Date.now();
  let redisRestarted = false;
  let opCount = 0;

  while (Date.now() - startTime < DURATION_MS) {
    const elapsed = Date.now() - startTime;
    if (!SKIP_REDIS_RESTART && !redisRestarted && elapsed > DURATION_MS / 2) {
      redisRestarted = true;
      console.log("[chaos] Restarting Redis mid-run...");
      execSync("docker compose restart redis", { stdio: "inherit" });
    }

    const idx = Math.floor(Math.random() * clients.length);
    const target = clients[idx];

    // 15% chance to flip online/offline
    if (Math.random() < 0.15) {
      target.online = !target.online;
      target.client.transport.setOnline(target.online);
    } else {
      const objIdx = Math.floor(Math.random() * 8);
      const field = Math.random() < 0.5 ? "x" : "y";
      target.client.mutate([
        {
          objectId: `obj_seed00000${objIdx}`,
          field,
          value: Math.floor(Math.random() * 1000),
        },
      ]);
      opCount += 1;
    }

    await sleep(40);
  }

  console.log(`[chaos] Sent ${opCount} mutation batches. Healing all 6 clients...`);
  for (const c of clients) {
    c.online = true;
    c.client.transport.setOnline(true);
  }

  // Wait for convergence (up to 15s)
  let converged = false;
  let serverSnap = { hash: "", snapshotSeq: 0 };
  for (let attempt = 0; attempt < 30; attempt++) {
    await sleep(500);
    serverSnap = await fetchSnapshotHash(boardId);
    const hashes = await Promise.all(clients.map((c) => c.client.map.stateHash()));
    const outboxDepths = await Promise.all(
      clients.map(async (c) => (await c.storage.load()).outbox.length),
    );

    if (hashes.every((h) => h === serverSnap.hash) && outboxDepths.every((d) => d === 0)) {
      converged = true;
      break;
    }
  }

  for (const c of clients) {
    await c.client.stop();
  }

  if (!converged) {
    console.error(
      "[chaos] FAILED: clients did not converge to server snapshot hash:",
      serverSnap.hash,
    );
    process.exit(1);
  }

  console.log(
    `[chaos] PASSED: all 6 clients across server1+server2 converged to server hash ${serverSnap.hash} (seq ${serverSnap.snapshotSeq})`,
  );
}

main().catch((err) => {
  console.error("[chaos] Fatal error:", err);
  process.exit(1);
});
