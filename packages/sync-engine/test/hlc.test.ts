import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { ClockSkewError, compareHlc, createHlcClock, formatHlc, parseHlc } from "../src/hlc.js";
import type { HlcString } from "../src/types.js";

interface HlcTickStep {
  op: "tick";
  now: number;
  expect: HlcString;
}

interface HlcRecvStep {
  op: "recv";
  now: number;
  remote: HlcString;
  expect?: HlcString;
  expectError?: string;
}

interface HlcVector {
  name: string;
  comment: string;
  nodeId: string;
  initial?: HlcString;
  maxDriftMs?: number;
  steps: Array<HlcTickStep | HlcRecvStep>;
}

const vectorPath = join(dirname(fileURLToPath(import.meta.url)), "../../../spec/vectors/hlc.json");
const vectors: HlcVector[] = JSON.parse(readFileSync(vectorPath, "utf8")) as HlcVector[];

describe("HLC helpers (parseHlc, formatHlc, compareHlc)", () => {
  it("round-trips valid HLC strings", () => {
    const raw = "1732579200450:00042:user_a_9f2";
    const parsed = parseHlc(raw);
    expect(parsed).toEqual({
      physicalTime: 1732579200450,
      counter: 42,
      nodeId: "user_a_9f2",
    });
    expect(formatHlc(parsed)).toBe(raw);
  });

  it("compares by physicalTime, then counter, then nodeId", () => {
    const a = "0000000001000:00001:user_a";
    const b = "0000000001000:00001:user_b";
    const c = "0000000001000:00002:user_a";
    const d = "0000000002000:00000:user_a";

    expect(compareHlc(a, a)).toBe(0);
    expect(compareHlc(a, b)).toBe(-1);
    expect(compareHlc(b, a)).toBe(1);
    expect(compareHlc(b, c)).toBe(-1);
    expect(compareHlc(c, d)).toBe(-1);
  });
});

describe("HLC golden vectors (spec/vectors/hlc.json)", () => {
  it.each(vectors)("$name", (vec) => {
    let currentTime = 0;
    const clock = createHlcClock({
      nodeId: vec.nodeId,
      now: () => currentTime,
      ...(vec.maxDriftMs !== undefined ? { maxDriftMs: vec.maxDriftMs } : {}),
      ...(vec.initial !== undefined ? { initial: vec.initial } : {}),
    });

    for (const step of vec.steps) {
      currentTime = step.now;
      if (step.op === "tick") {
        expect(clock.tick()).toBe(step.expect);
        expect(clock.last()).toBe(step.expect);
      } else if (step.expectError === "CLOCK_SKEW") {
        const before = clock.last();
        expect(() => clock.receive(step.remote)).toThrow(ClockSkewError);
        expect(clock.last()).toBe(before);
      } else {
        clock.receive(step.remote);
        expect(clock.last()).toBe(step.expect);
      }
    }
  });
});

describe("HLC monotonic property (fast-check)", () => {
  type Event =
    | { kind: "tick"; dt: number }
    | { kind: "recv"; dt: number; remoteOffset: number; remoteCounter: number; remoteNode: string };

  const eventArb: fc.Arbitrary<Event> = fc.oneof(
    fc.record({
      kind: fc.constant("tick" as const),
      dt: fc.integer({ min: -5000, max: 5000 }),
    }),
    fc.record({
      kind: fc.constant("recv" as const),
      dt: fc.integer({ min: -5000, max: 5000 }),
      remoteOffset: fc.integer({ min: -10_000, max: 70_000 }),
      remoteCounter: fc.integer({ min: 0, max: 99_999 }),
      remoteNode: fc.constantFrom("node_b", "node_c", "node_d"),
    }),
  );

  it("any interleaving of tick and receive produces strictly increasing HLCs per node", () => {
    fc.assert(
      fc.property(fc.array(eventArb, { minLength: 1, maxLength: 100 }), (events) => {
        let now = 1_700_000_000_000;
        const clock = createHlcClock({
          nodeId: "node_a",
          now: () => now,
          maxDriftMs: 60_000,
        });

        let prev = clock.last();
        for (const ev of events) {
          now = Math.max(0, now + ev.dt);
          if (ev.kind === "tick") {
            const next = clock.tick();
            expect(compareHlc(next, prev)).toBe(1);
            expect(clock.last()).toBe(next);
            prev = next;
          } else {
            const remotePt = Math.max(0, now + ev.remoteOffset);
            const remote = formatHlc({
              physicalTime: remotePt,
              counter: ev.remoteCounter,
              nodeId: ev.remoteNode,
            });
            if (remotePt > now + 60_000) {
              expect(() => clock.receive(remote)).toThrow(ClockSkewError);
              expect(clock.last()).toBe(prev);
            } else {
              clock.receive(remote);
              const next = clock.last();
              expect(compareHlc(next, prev)).toBe(1);
              expect(compareHlc(next, remote)).toBe(1);
              prev = next;
            }
          }
        }
      }),
      { numRuns: 200 },
    );
  });
});
