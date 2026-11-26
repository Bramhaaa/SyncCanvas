import canonicalize from "canonicalize";
import type { FieldValue, HlcString, Register } from "./types.js";

function codePointCompare(a: string, b: string): number {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

/**
 * Computes the canonical RFC 8785 (JCS) JSON string for a register collection:
 * sorted array of [objectId, field, value, hlc] tuples ordered by (objectId, field).
 */
export function canonicalizeRegisters(
  entries: Iterable<[objectId: string, field: string, reg: Register]>,
): string {
  const tuples: Array<[string, string, FieldValue, HlcString]> = [];
  for (const [objectId, field, reg] of entries) {
    tuples.push([objectId, field, reg.value, reg.hlc]);
  }

  tuples.sort((a, b) => {
    const objCmp = codePointCompare(a[0], b[0]);
    if (objCmp !== 0) return objCmp;
    return codePointCompare(a[1], b[1]);
  });

  const jcs = canonicalize(tuples);
  if (jcs === undefined) {
    throw new Error("Failed to canonicalize CRDT registers with RFC 8785 JCS");
  }
  return jcs;
}

/**
 * Computes the lowercase hex SHA-256 state hash of the canonical JCS register array.
 * Uses Web Crypto (`globalThis.crypto.subtle`) so it works identically in Node 22 and browsers.
 */
export async function computeStateHash(
  entries: Iterable<[objectId: string, field: string, reg: Register]>,
): Promise<string> {
  const jcs = canonicalizeRegisters(entries);
  const bytes = new TextEncoder().encode(jcs);
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}
