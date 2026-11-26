import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { createLwwMap } from "../src/lww-map.js";
import type { Op, SnapshotState } from "../src/types.js";

interface MergeVector {
  name: string;
  comment: string;
  ops: Op[];
  expectState: SnapshotState;
  expectVisibleIds?: string[];
  expectHash: string;
}

const vectorPath = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../../spec/vectors/merge.json",
);
const vectors: MergeVector[] = JSON.parse(readFileSync(vectorPath, "utf8")) as MergeVector[];

describe("LwwMap golden vectors (spec/vectors/merge.json)", () => {
  it.each(vectors)("$name", async (vec) => {
    const map = createLwwMap();
    for (const op of vec.ops) {
      map.apply(op);
    }

    expect(map.toJSON()).toEqual(vec.expectState);

    if (vec.expectVisibleIds !== undefined) {
      expect(map.visibleObjectIds()).toEqual(vec.expectVisibleIds);
    }

    const hash = await map.stateHash();
    expect(vec.expectHash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).toBe(vec.expectHash);
  });

  it("forward and reversed commutative vectors produce the exact same stateHash", async () => {
    const forward = vectors.find((v) => v.name === "commutative: forward order");
    const reversed = vectors.find((v) => v.name === "commutative: reversed order");
    expect(forward).toBeDefined();
    expect(reversed).toBeDefined();

    const mapA = createLwwMap();
    for (const op of forward!.ops) mapA.apply(op);

    const mapB = createLwwMap();
    for (const op of reversed!.ops) mapB.apply(op);

    expect(await mapA.stateHash()).toBe(await mapB.stateHash());
  });
});

describe("LwwMap unit behavior", () => {
  it("returns ACCEPTED with previous register on overwrite and DISCARDED_STALE on stale/duplicate", () => {
    const map = createLwwMap();

    const r1 = map.apply({
      objectId: "obj_1",
      field: "x",
      value: 10,
      hlc: "0000000001000:00000:a",
    });
    expect(r1).toEqual({ status: "ACCEPTED" });

    const r2 = map.apply({
      objectId: "obj_1",
      field: "x",
      value: 25,
      hlc: "0000000002000:00000:a",
    });
    expect(r2).toEqual({
      status: "ACCEPTED",
      previous: { value: 10, hlc: "0000000001000:00000:a" },
    });

    const dup = map.apply({
      objectId: "obj_1",
      field: "x",
      value: 25,
      hlc: "0000000002000:00000:a",
    });
    expect(dup.status).toBe("DISCARDED_STALE");

    const stale = map.apply({
      objectId: "obj_1",
      field: "x",
      value: 5,
      hlc: "0000000001500:00000:b",
    });
    expect(stale).toEqual({
      status: "DISCARDED_STALE",
      current: { value: 25, hlc: "0000000002000:00000:a" },
      reason: "remote hlc < local hlc",
    });
  });

  it("getObject returns undefined when missing, lacking type, or deleted", () => {
    const map = createLwwMap();
    expect(map.getObject("obj_missing")).toBeUndefined();

    map.apply({ objectId: "obj_1", field: "x", value: 10, hlc: "0000000001000:00000:a" });
    expect(map.getObject("obj_1")).toBeUndefined();

    map.apply({ objectId: "obj_1", field: "type", value: "rect", hlc: "0000000001000:00001:a" });
    expect(map.getObject("obj_1")).toEqual({ x: 10, type: "rect" });

    map.apply({ objectId: "obj_1", field: "deleted", value: true, hlc: "0000000002000:00000:a" });
    expect(map.getObject("obj_1")).toBeUndefined();

    map.apply({ objectId: "obj_1", field: "deleted", value: false, hlc: "0000000003000:00000:a" });
    expect(map.getObject("obj_1")).toEqual({ x: 10, type: "rect", deleted: false });
  });

  it("visibleObjectIds places objects without zIndex first and hydrates identically from toJSON", async () => {
    const map = createLwwMap();
    map.apply({ objectId: "obj_z", field: "type", value: "rect", hlc: "0000000001000:00000:a" });
    map.apply({ objectId: "obj_a", field: "type", value: "rect", hlc: "0000000001000:00001:a" });
    map.apply({ objectId: "obj_a", field: "zIndex", value: "a0", hlc: "0000000001000:00002:a" });

    expect(map.visibleObjectIds()).toEqual(["obj_z", "obj_a"]);

    const hydrated = createLwwMap(map.toJSON());
    expect(hydrated.toJSON()).toEqual(map.toJSON());
    expect(await hydrated.stateHash()).toBe(await map.stateHash());
  });
});
