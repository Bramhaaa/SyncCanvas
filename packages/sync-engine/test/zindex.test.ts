import { describe, expect, it } from "vitest";
import { bringToFront, keyAbove, keyBetween, sendToBack } from "../src/zindex.js";

function codePointCompare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

describe("zindex (fractional indexing)", () => {
  it("handles null and undefined bounds in keyBetween", () => {
    const first = keyBetween(null, null);
    const second = keyBetween(first, null);
    const beforeFirst = keyBetween(null, first);
    const middle = keyBetween(first, second);
    const undefBounds = keyBetween(undefined, undefined);

    expect(undefBounds).toBe(first);
    expect(beforeFirst < first).toBe(true);
    expect(first < middle).toBe(true);
    expect(middle < second).toBe(true);
  });

  it("bringToFront and sendToBack handle empty and populated collections", () => {
    const k0 = bringToFront([]);
    const kBackEmpty = sendToBack([]);
    expect(kBackEmpty).toBe(k0);

    const k1 = bringToFront([k0]);
    const k2 = bringToFront([k1, k0]);
    const kMin = sendToBack([k1, k0, k2]);

    expect(kMin < k0).toBe(true);
    expect(k0 < k1).toBe(true);
    expect(k1 < k2).toBe(true);
  });

  it("keyAbove inserts immediately above target key without disturbing others", () => {
    const a = keyBetween(null, null);
    const b = keyBetween(a, null);
    const c = keyBetween(b, null);

    const betweenAB = keyAbove(a, [c, a, b]);
    expect(a < betweenAB).toBe(true);
    expect(betweenAB < b).toBe(true);

    const aboveTop = keyAbove(c, [a, b, c]);
    expect(c < aboveTop).toBe(true);

    const aboveEmpty = keyAbove(a, []);
    expect(a < aboveEmpty).toBe(true);
  });

  it("maintains strict code-point ordering across 1,000 random inserts", () => {
    // Deterministic LCG PRNG so the test is reproducible.
    let seed = 0x5f3759df;
    const nextRand = (): number => {
      seed = (Math.imul(1664525, seed) + 1013904223) >>> 0;
      return seed / 0x100000000;
    };

    const ordered: string[] = [];

    for (let i = 0; i < 1000; i++) {
      const choice = Math.floor(nextRand() * 4);
      let nextKey: string;

      if (ordered.length === 0 || choice === 0) {
        nextKey = bringToFront(ordered);
        ordered.push(nextKey);
      } else if (choice === 1) {
        nextKey = sendToBack(ordered);
        ordered.unshift(nextKey);
      } else if (choice === 2) {
        const idx = Math.floor(nextRand() * ordered.length);
        const anchor = ordered[idx]!;
        nextKey = keyAbove(anchor, ordered);
        ordered.splice(idx + 1, 0, nextKey);
      } else {
        const idx = Math.floor(nextRand() * (ordered.length + 1));
        const left = idx > 0 ? ordered[idx - 1] : null;
        const right = idx < ordered.length ? ordered[idx] : null;
        nextKey = keyBetween(left, right);
        ordered.splice(idx, 0, nextKey);
      }
    }

    expect(ordered).toHaveLength(1000);
    for (let i = 1; i < ordered.length; i++) {
      expect(codePointCompare(ordered[i - 1]!, ordered[i]!)).toBe(-1);
    }

    const sortedCopy = [...ordered].sort(codePointCompare);
    expect(ordered).toEqual(sortedCopy);
  });
});
