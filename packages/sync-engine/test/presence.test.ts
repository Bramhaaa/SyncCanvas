import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { colorFromNodeId, createPresenceClient } from "../src/presence.js";
import { createFakeServer } from "../src/transport/loopback.js";

describe("PresenceClient (T32)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("assigns deterministic hex colors from nodeId", () => {
    const c1 = colorFromNodeId("user_a_9f2");
    const c2 = colorFromNodeId("user_a_9f2");
    expect(c1).toBe(c2);
    expect(c1).toMatch(/^#[0-9a-f]{6}$/);
  });

  it("throttles cursor updates to 50ms, deduplicates unchanged updates, and expires stale peers after 5s", () => {
    const server = createFakeServer();
    const tA = server.createTransport("user_a");
    const tB = server.createTransport("user_b");
    tA.connect();
    tB.connect();

    let currentNow = 10_000;
    const now = () => currentNow;

    const pA = createPresenceClient({
      transport: tA,
      clientId: "user_a",
      displayName: "User A",
      throttleMs: 50,
      staleTimeoutMs: 5_000,
      now,
    });
    const pB = createPresenceClient({
      transport: tB,
      clientId: "user_b",
      displayName: "User B",
      throttleMs: 50,
      staleTimeoutMs: 5_000,
      now,
    });

    pA.start();
    pB.start();

    let bNotifications = 0;
    pB.subscribe(() => {
      bNotifications += 1;
    });

    // First update sends immediately
    pA.update({ cursor: { x: 10, y: 20 }, selectedIds: ["obj_1"] });
    expect(pB.getPeers()).toHaveLength(1);
    expect(pB.getPeers()[0]?.cursor).toEqual({ x: 10, y: 20 });
    expect(bNotifications).toBe(1);

    // Identical update is ignored
    currentNow += 100;
    pA.update({ cursor: { x: 10, y: 20 }, selectedIds: ["obj_1"] });
    expect(bNotifications).toBe(1);

    // Rapid updates within 50ms coalesce to a single trailing send
    pA.update({ cursor: { x: 20, y: 30 } });
    pA.update({ cursor: { x: 30, y: 40 } });
    pA.update({ cursor: { x: 40, y: 50 } });
    expect(bNotifications).toBe(2); // first rapid update fired immediately since 100ms elapsed
    currentNow += 50;
    vi.advanceTimersByTime(50);
    expect(bNotifications).toBe(3);
    expect(pB.getPeers()[0]?.cursor).toEqual({ x: 40, y: 50 });

    // After > 5s with no update, peer disappears automatically
    currentNow += 6_000;
    vi.advanceTimersByTime(1_000);
    expect(pB.getPeers()).toHaveLength(0);

    // Re-appear then explicit leave removes peer immediately
    pA.update({ cursor: { x: 100, y: 100 } });
    expect(pB.getPeers()).toHaveLength(1);
    pA.leave();
    expect(pB.getPeers()).toHaveLength(0);

    pA.stop();
    pB.stop();
  });
});
