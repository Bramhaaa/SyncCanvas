import { check, sleep } from "k6";
import http from "k6/http";
import { Counter, Trend } from "k6/metrics";
import { WebSocket } from "k6/experimental/websockets";

const API_URL = __ENV.API_URL || "http://localhost:8080";
const WS_URL = __ENV.WS_URL || "ws://localhost:8080";
const BOARD_COUNT = Number(__ENV.BOARDS || "100");
const TARGET_VUS = Number(__ENV.VUS || "1000");

const broadcastLatency = new Trend("broadcast_latency_ms", true);
const opsSent = new Counter("ops_sent");
const opsReceived = new Counter("ops_received");
const wsErrors = new Counter("ws_errors");

export const options = {
  scenarios: {
    collaborative_load: {
      executor: "ramping-vus",
      startVUs: 0,
      stages: [
        { duration: __ENV.RAMP_UP || "2m", target: TARGET_VUS },
        { duration: __ENV.HOLD || "5m", target: TARGET_VUS },
        { duration: __ENV.RAMP_DOWN || "30s", target: 0 },
      ],
    },
  },
  thresholds: {
    broadcast_latency_ms: ["p(95)<150", "p(99)<300"],
    ws_errors: ["count<100"],
  },
};

export function setup() {
  const boardIds = [];
  for (let i = 0; i < BOARD_COUNT; i++) {
    const res = http.post(
      `${API_URL}/api/v1/boards`,
      JSON.stringify({ title: `k6 Load Board ${i}`, isDemo: true }),
      { headers: { "Content-Type": "application/json" } },
    );
    check(res, { "board created (201)": (r) => r.status === 201 });
    if (res.status === 201) {
      boardIds.push(res.json("boardId"));
    }
  }
  if (boardIds.length === 0) {
    throw new Error(`Failed to create any boards at ${API_URL}/api/v1/boards`);
  }
  return { boardIds };
}

function formatHlc(ms, counter, nodeId) {
  return `${String(ms).padStart(13, "0")}:${String(counter).padStart(5, "0")}:${nodeId}`;
}

export default function (data) {
  const vuId = __VU;
  const nodeId = `k6_vu_${vuId}`;
  const boardId = data.boardIds[(vuId - 1) % data.boardIds.length];
  const url = `${WS_URL}/ws/boards/${boardId}?clientId=${nodeId}`;

  const ws = new WebSocket(url);
  let counter = 0;
  let presenceInterval = null;
  let pushInterval = null;

  ws.addEventListener("open", () => {
    ws.send(JSON.stringify({ type: "SYNC_PULL", lastSyncedSeq: 0 }));

    // 10 Hz presence
    presenceInterval = setInterval(() => {
      ws.send(
        JSON.stringify({
          type: "PRESENCE",
          clientId: nodeId,
          displayName: `VU ${vuId}`,
          color: "#2563eb",
          cursor: { x: Math.random() * 1000, y: Math.random() * 800 },
          selectedIds: [],
        }),
      );
    }, 100);

    // 1-2 ops every 2 seconds with send timestamp embedded in `x`
    pushInterval = setInterval(() => {
      const now = Date.now();
      counter = (counter + 1) % 99_999;
      const objectId = `obj_vu${String(vuId).padStart(6, "0")}`;
      const ops = [
        { objectId, field: "type", value: "rect", hlc: formatHlc(now, counter, nodeId) },
        { objectId, field: "x", value: now, hlc: formatHlc(now, counter + 1, nodeId) },
      ];
      counter += 1;
      ws.send(JSON.stringify({ type: "SYNC_PUSH", clientId: nodeId, ops }));
      opsSent.add(ops.length);
    }, 2000);
  });

  ws.addEventListener("message", (event) => {
    try {
      const msg = JSON.parse(event.data);
      if (msg.type === "SYNC_BROADCAST" && Array.isArray(msg.ops)) {
        const recvNow = Date.now();
        opsReceived.add(msg.ops.length);
        for (const op of msg.ops) {
          if (op.field === "x" && typeof op.value === "number" && op.value > 1_700_000_000_000) {
            const delta = recvNow - op.value;
            if (delta >= 0 && delta < 30_000) {
              broadcastLatency.add(delta);
            }
          }
        }
      } else if (msg.type === "ERROR") {
        wsErrors.add(1);
      }
    } catch {
      wsErrors.add(1);
    }
  });

  ws.addEventListener("error", () => {
    wsErrors.add(1);
  });

  ws.addEventListener("close", () => {
    if (presenceInterval !== null) clearInterval(presenceInterval);
    if (pushInterval !== null) clearInterval(pushInterval);
  });

  // Keep VU alive during stage
  sleep(30);
  ws.close();
}
