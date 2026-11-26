import { compareHlc } from "../hlc.js";
import type { HlcString, Meta, Op, Register, SnapshotState, Storage } from "../types.js";

export interface MemoryStorageOptions {
  nodeId?: string;
}

function outboxKey(objectId: string, field: string): string {
  return `${objectId}|${field}`;
}

export function createMemoryStorage(options: MemoryStorageOptions = {}): Storage {
  const initialNodeId = options.nodeId ?? "";
  const registers = new Map<string, Map<string, Register>>();
  const outbox = new Map<string, Op>();
  let meta: Meta = {
    nodeId: initialNodeId,
    lastSyncedSeq: 0,
    lastHlc: null,
  };

  return {
    async load(): Promise<{ state: SnapshotState; outbox: Op[]; meta: Meta }> {
      const state: SnapshotState = {};
      for (const [objectId, fields] of registers) {
        const objRecord: Record<string, Register> = {};
        for (const [field, reg] of fields) {
          objRecord[field] = {
            value: structuredClone(reg.value),
            hlc: reg.hlc,
          };
        }
        state[objectId] = objRecord;
      }

      const outboxList = Array.from(outbox.values())
        .map((op) => ({
          objectId: op.objectId,
          field: op.field,
          value: structuredClone(op.value),
          hlc: op.hlc,
        }))
        .sort((a, b) => compareHlc(a.hlc, b.hlc));

      return {
        state,
        outbox: outboxList,
        meta: { ...meta },
      };
    },

    async putRegisters(ops: Op[]): Promise<void> {
      for (const op of ops) {
        let fields = registers.get(op.objectId);
        if (fields === undefined) {
          fields = new Map<string, Register>();
          registers.set(op.objectId, fields);
        }
        const existing = fields.get(op.field);
        if (existing === undefined || compareHlc(op.hlc, existing.hlc) > 0) {
          fields.set(op.field, {
            value: structuredClone(op.value),
            hlc: op.hlc,
          });
        }
      }
    },

    async outboxPut(ops: Op[]): Promise<void> {
      for (const op of ops) {
        const key = outboxKey(op.objectId, op.field);
        const existing = outbox.get(key);
        if (existing === undefined || compareHlc(op.hlc, existing.hlc) > 0) {
          outbox.set(key, {
            objectId: op.objectId,
            field: op.field,
            value: structuredClone(op.value),
            hlc: op.hlc,
          });
        }
      }
    },

    async outboxRemove(hlcs: HlcString[]): Promise<void> {
      if (hlcs.length === 0) return;
      const toRemove = new Set(hlcs);
      for (const [key, op] of outbox) {
        if (toRemove.has(op.hlc)) {
          outbox.delete(key);
        }
      }
    },

    async setMeta(patch: Partial<Meta>): Promise<void> {
      meta = { ...meta, ...patch };
    },

    async destroy(): Promise<void> {
      registers.clear();
      outbox.clear();
      meta = {
        nodeId: initialNodeId,
        lastSyncedSeq: 0,
        lastHlc: null,
      };
    },
  };
}
