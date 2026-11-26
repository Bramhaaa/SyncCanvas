import { generateKeyBetween } from "fractional-indexing";

/**
 * Generates a fractional-index key strictly between `a` and `b`
 * in UTF-16 / ASCII code-point order. Either bound may be null/undefined.
 */
export function keyBetween(a: string | null | undefined, b: string | null | undefined): string {
  return generateKeyBetween(a ?? null, b ?? null);
}

/**
 * Generates a key that sorts strictly after every key in `allKeys`.
 * When `allKeys` is empty, returns the initial fractional key (`"a0"`).
 */
export function bringToFront(allKeys: Iterable<string>): string {
  let maxKey: string | null = null;
  for (const k of allKeys) {
    if (maxKey === null || k > maxKey) {
      maxKey = k;
    }
  }
  return generateKeyBetween(maxKey, null);
}

/**
 * Generates a key that sorts strictly before every key in `allKeys`.
 * When `allKeys` is empty, returns the initial fractional key (`"a0"`).
 */
export function sendToBack(allKeys: Iterable<string>): string {
  let minKey: string | null = null;
  for (const k of allKeys) {
    if (minKey === null || k < minKey) {
      minKey = k;
    }
  }
  return generateKeyBetween(null, minKey);
}

/**
 * Generates a key that sorts strictly after `key` and strictly before the
 * smallest key in `allKeys` that is greater than `key` (if any).
 */
export function keyAbove(key: string, allKeys: Iterable<string>): string {
  let nextHigher: string | null = null;
  for (const k of allKeys) {
    if (k > key && (nextHigher === null || k < nextHigher)) {
      nextHigher = k;
    }
  }
  return generateKeyBetween(key, nextHigher);
}
