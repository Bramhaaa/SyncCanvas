import { computeStateHash } from "./hash.js";
import { compareHlc } from "./hlc.js";
import type { FieldValue, LwwMap, MergeResult, Op, Register, SnapshotState } from "./types.js";

function codePointCompare(a: string, b: string): number {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

export function createLwwMap(initial?: SnapshotState): LwwMap {
  const objects = new Map<string, Map<string, Register>>();

  if (initial !== undefined) {
    for (const [objectId, fields] of Object.entries(initial)) {
      const fieldMap = new Map<string, Register>();
      for (const [field, reg] of Object.entries(fields)) {
        fieldMap.set(field, { value: reg.value, hlc: reg.hlc });
      }
      if (fieldMap.size > 0) {
        objects.set(objectId, fieldMap);
      }
    }
  }

  function isVisible(fields: Map<string, Register>): boolean {
    if (!fields.has("type")) return false;
    const deleted = fields.get("deleted");
    return deleted === undefined || deleted.value !== true;
  }

  function* entries(): Iterable<[objectId: string, field: string, reg: Register]> {
    for (const [objectId, fields] of objects) {
      for (const [field, reg] of fields) {
        yield [objectId, field, reg];
      }
    }
  }

  return {
    apply(op: Op): MergeResult {
      let fields = objects.get(op.objectId);
      if (fields === undefined) {
        fields = new Map<string, Register>();
        objects.set(op.objectId, fields);
      }

      const current = fields.get(op.field);
      if (current === undefined) {
        fields.set(op.field, { value: op.value, hlc: op.hlc });
        return { status: "ACCEPTED" };
      }

      const cmp = compareHlc(op.hlc, current.hlc);
      if (cmp > 0) {
        fields.set(op.field, { value: op.value, hlc: op.hlc });
        return { status: "ACCEPTED", previous: current };
      }

      return {
        status: "DISCARDED_STALE",
        current,
        reason: cmp === 0 ? "duplicate hlc" : "remote hlc < local hlc",
      };
    },

    get(objectId: string, field: string): Register | undefined {
      return objects.get(objectId)?.get(field);
    },

    getObject(objectId: string): Record<string, FieldValue> | undefined {
      const fields = objects.get(objectId);
      if (fields === undefined || !isVisible(fields)) {
        return undefined;
      }

      const result: Record<string, FieldValue> = {};
      for (const [field, reg] of fields) {
        result[field] = reg.value;
      }
      return result;
    },

    visibleObjectIds(): string[] {
      const visible: Array<{ id: string; zIndex: string }> = [];
      for (const [objectId, fields] of objects) {
        if (!isVisible(fields)) continue;
        const zReg = fields.get("zIndex");
        const zIndex = typeof zReg?.value === "string" ? zReg.value : "";
        visible.push({ id: objectId, zIndex });
      }

      visible.sort((a, b) => {
        const zCmp = codePointCompare(a.zIndex, b.zIndex);
        if (zCmp !== 0) return zCmp;
        return codePointCompare(a.id, b.id);
      });

      return visible.map((item) => item.id);
    },

    entries,

    stateHash(): Promise<string> {
      return computeStateHash(entries());
    },

    toJSON(): SnapshotState {
      const snapshot: SnapshotState = {};
      for (const [objectId, fields] of objects) {
        const objRecord: Record<string, Register> = {};
        for (const [field, reg] of fields) {
          objRecord[field] = { value: reg.value, hlc: reg.hlc };
        }
        snapshot[objectId] = objRecord;
      }
      return snapshot;
    },
  };
}
