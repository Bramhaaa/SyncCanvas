import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { computeStateHash } from "../../src/hash.js";
import { compareHlc } from "../../src/hlc.js";
import type {
  FieldValue,
  LwwMap,
  MergeResult,
  Op,
  Register,
  SnapshotState,
} from "../../src/types.js";
import { Simulator, type NetworkAction, type SimMutation } from "./simulator.js";

const REPLICA_COUNT = 5;
const OBJECT_IDS = ["obj_a", "obj_b", "obj_c", "obj_d", "obj_e", "obj_f"];
const COLORS = ["#EF4444", "#3B82F6", "#10B981", "#F59E0B", "#8B5CF6"];

const mutationArb: fc.Arbitrary<SimMutation> = fc.oneof(
  fc.record({
    kind: fc.constant("create" as const),
    replica: fc.integer({ min: 0, max: REPLICA_COUNT - 1 }),
    objectId: fc.constantFrom(...OBJECT_IDS),
    x: fc.integer({ min: -500, max: 500 }),
    y: fc.integer({ min: -500, max: 500 }),
    fill: fc.constantFrom(...COLORS),
  }),
  fc.record({
    kind: fc.constant("move" as const),
    replica: fc.integer({ min: 0, max: REPLICA_COUNT - 1 }),
    objectId: fc.constantFrom(...OBJECT_IDS),
    x: fc.integer({ min: -500, max: 500 }),
    y: fc.integer({ min: -500, max: 500 }),
  }),
  fc.record({
    kind: fc.constant("recolor" as const),
    replica: fc.integer({ min: 0, max: REPLICA_COUNT - 1 }),
    objectId: fc.constantFrom(...OBJECT_IDS),
    fill: fc.constantFrom(...COLORS),
  }),
  fc.record({
    kind: fc.constant("delete" as const),
    replica: fc.integer({ min: 0, max: REPLICA_COUNT - 1 }),
    objectId: fc.constantFrom(...OBJECT_IDS),
  }),
  fc.record({
    kind: fc.constant("undelete" as const),
    replica: fc.integer({ min: 0, max: REPLICA_COUNT - 1 }),
    objectId: fc.constantFrom(...OBJECT_IDS),
  }),
  fc.record({
    kind: fc.constant("text" as const),
    replica: fc.integer({ min: 0, max: REPLICA_COUNT - 1 }),
    objectId: fc.constantFrom(...OBJECT_IDS),
    text: fc.constantFrom("hello", "world", "sync", "canvas", ""),
  }),
);

const networkActionArb: fc.Arbitrary<NetworkAction> = fc.oneof(
  fc.record({ kind: fc.constant("deliver" as const), index: fc.integer({ min: 0, max: 500 }) }),
  fc.record({ kind: fc.constant("duplicate" as const), index: fc.integer({ min: 0, max: 500 }) }),
  fc.record({
    kind: fc.constant("drop_and_retry" as const),
    index: fc.integer({ min: 0, max: 500 }),
  }),
  fc.record({
    kind: fc.constant("toggle_partition" as const),
    replica: fc.integer({ min: 0, max: REPLICA_COUNT - 1 }),
  }),
  fc.record({ kind: fc.constant("advance_time" as const), dt: fc.integer({ min: 0, max: 200 }) }),
);

type Step = { type: "mutate"; mutation: SimMutation } | { type: "net"; action: NetworkAction };

const stepArb: fc.Arbitrary<Step> = fc.oneof(
  { weight: 3, arbitrary: mutationArb.map((mutation) => ({ type: "mutate" as const, mutation })) },
  { weight: 5, arbitrary: networkActionArb.map((action) => ({ type: "net" as const, action })) },
);

/**
 * Deliberately broken LwwMap fixture (uses `>=` instead of `>` for HLC comparison,
 * breaking commutativity/determinism when ties or order-sensitive replays occur,
 * and breaking timestamp comparison by accepting equal/lower-counter overwrites).
 */
function createBrokenMergeMap(): LwwMap {
  const objects = new Map<string, Map<string, Register>>();

  function* entries(): Iterable<[string, string, Register]> {
    for (const [objectId, fields] of objects) {
      for (const [field, reg] of fields) {
        yield [objectId, field, reg];
      }
    }
  }

  return {
    apply(op: Op): MergeResult {
      let fields = objects.get(op.objectId);
      if (!fields) {
        fields = new Map();
        objects.set(op.objectId, fields);
      }
      const cur = fields.get(op.field);
      // Deliberate bug: compares only physicalTime (ignoring counter + nodeId) with >=
      if (!cur || op.hlc.slice(0, 13) >= cur.hlc.slice(0, 13)) {
        fields.set(op.field, { value: op.value, hlc: op.hlc });
        return cur ? { status: "ACCEPTED", previous: cur } : { status: "ACCEPTED" };
      }
      return { status: "DISCARDED_STALE", current: cur, reason: "stale" };
    },
    get(objectId, field) {
      return objects.get(objectId)?.get(field);
    },
    getObject(objectId) {
      const fields = objects.get(objectId);
      if (!fields || !fields.has("type") || fields.get("deleted")?.value === true) return undefined;
      const out: Record<string, FieldValue> = {};
      for (const [k, v] of fields) out[k] = v.value;
      return out;
    },
    visibleObjectIds() {
      const ids: string[] = [];
      for (const [id, fields] of objects) {
        if (fields.has("type") && fields.get("deleted")?.value !== true) ids.push(id);
      }
      return ids.sort();
    },
    entries,
    stateHash() {
      return computeStateHash(entries());
    },
    toJSON(): SnapshotState {
      const out: SnapshotState = {};
      for (const [id, fields] of objects) {
        out[id] = {};
        for (const [k, v] of fields) out[id]![k] = v;
      }
      return out;
    },
  };
}

describe("CRDT convergence simulator (T05)", () => {
  it("converges 5 replicas across >= 10,000 ops under skew, partitions, drops, duplicates, and reordering", async () => {
    let totalEmittedOps = 0;

    await fc.assert(
      fc.asyncProperty(
        fc.array(fc.integer({ min: -5000, max: 5000 }), {
          minLength: REPLICA_COUNT,
          maxLength: REPLICA_COUNT,
        }),
        fc.array(stepArb, { minLength: 100, maxLength: 140 }),
        async (skews, steps) => {
          const sim = new Simulator({ replicaSkewsMs: skews });

          for (const step of steps) {
            if (step.type === "mutate") {
              sim.applyLocal(step.mutation);
            } else {
              sim.stepNetwork(step.action);
            }
          }

          sim.healAndDrain();
          totalEmittedOps += sim.emittedOps;

          const hashes = await Promise.all(sim.replicas.map((r) => r.map.stateHash()));
          const expectedHash = hashes[0]!;
          for (let i = 1; i < hashes.length; i++) {
            expect(hashes[i]).toBe(expectedHash);
          }

          const expectedVisible = sim.replicas[0]!.map.visibleObjectIds();
          for (const rep of sim.replicas) {
            expect(rep.map.visibleObjectIds()).toEqual(expectedVisible);
            for (const id of rep.map.visibleObjectIds()) {
              const obj = rep.map.getObject(id);
              expect(obj).toBeDefined();
              expect(typeof obj?.type).toBe("string");
            }
          }
        },
      ),
      { numRuns: 120 },
    );

    expect(totalEmittedOps).toBeGreaterThanOrEqual(10_000);
  });

  it("detects non-convergence when given a deliberately broken merge implementation", async () => {
    // Two replicas write to the same field at the same physicalTime with different nodeIds;
    // broken merge uses `>=` on physicalTime only, so arrival order determines the winner.
    const sim = new Simulator({
      replicaSkewsMs: [0, 0],
      createMap: createBrokenMergeMap,
    });

    const opA = sim.applyLocal({ kind: "recolor", replica: 0, objectId: "obj_a", fill: "#EF4444" });
    const opB = sim.applyLocal({ kind: "recolor", replica: 1, objectId: "obj_a", fill: "#3B82F6" });
    expect(compareHlc(opA[0]!.hlc, opB[0]!.hlc)).not.toBe(0);

    sim.healAndDrain();

    const hash0 = await sim.replicas[0]!.map.stateHash();
    const hash1 = await sim.replicas[1]!.map.stateHash();
    expect(hash0).not.toBe(hash1);
  });
});
