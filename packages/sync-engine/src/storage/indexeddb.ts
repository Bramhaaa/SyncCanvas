import Dexie, { type DexieOptions, type Table } from "dexie";
import { compareHlc } from "../hlc.js";
import type { FieldValue, HlcString, Meta, Op, SnapshotState, Storage } from "../types.js";

interface RegisterRow {
  objectId: string;
  field: string;
  value: FieldValue;
  hlc: HlcString;
}

interface OutboxRow {
  key: string;
  objectId: string;
  field: string;
  value: FieldValue;
  hlc: HlcString;
}

interface MetaRow extends Meta {
  id: "singleton";
}

class SyncCanvasDb extends Dexie {
  registers!: Table<RegisterRow, [string, string]>;
  outbox!: Table<OutboxRow, string>;
  meta!: Table<MetaRow, string>;

  constructor(name: string, options?: DexieOptions) {
    super(name, options);
    this.version(1).stores({
      registers: "[objectId+field]",
      outbox: "key, hlc",
      meta: "id",
    });
  }
}

export interface IndexedDbStorageOptions {
  boardId: string;
  paneId: string;
  nodeId?: string;
  /** Optional Dexie options (e.g. `{ indexedDB, IDBKeyRange }` for tests). */
  dexieOptions?: DexieOptions;
}

function outboxKey(objectId: string, field: string): string {
  return `${objectId}|${field}`;
}

export function createIndexedDbStorage(options: IndexedDbStorageOptions): Storage {
  const { boardId, paneId, nodeId = "", dexieOptions } = options;
  const dbName = `synccanvas_${boardId}_${paneId}`;
  const db = new SyncCanvasDb(dbName, dexieOptions);

  return {
    async load(): Promise<{ state: SnapshotState; outbox: Op[]; meta: Meta }> {
      return db.transaction("r", db.registers, db.outbox, db.meta, async () => {
        const [regRows, outboxRows, metaRow] = await Promise.all([
          db.registers.toArray(),
          db.outbox.toArray(),
          db.meta.get("singleton"),
        ]);

        const state: SnapshotState = {};
        for (const row of regRows) {
          let obj = state[row.objectId];
          if (obj === undefined) {
            obj = {};
            state[row.objectId] = obj;
          }
          obj[row.field] = { value: row.value, hlc: row.hlc };
        }

        const outbox: Op[] = outboxRows
          .map((row) => ({
            objectId: row.objectId,
            field: row.field,
            value: row.value,
            hlc: row.hlc,
          }))
          .sort((a, b) => compareHlc(a.hlc, b.hlc));

        const meta: Meta = metaRow
          ? {
              nodeId: metaRow.nodeId,
              lastSyncedSeq: metaRow.lastSyncedSeq,
              lastHlc: metaRow.lastHlc,
            }
          : {
              nodeId,
              lastSyncedSeq: 0,
              lastHlc: null,
            };

        return { state, outbox, meta };
      });
    },

    async putRegisters(ops: Op[]): Promise<void> {
      if (ops.length === 0) return;

      // Coalesce within the batch first so we only read/write each key once.
      const batch = new Map<string, Op>();
      for (const op of ops) {
        const k = outboxKey(op.objectId, op.field);
        const prev = batch.get(k);
        if (prev === undefined || compareHlc(op.hlc, prev.hlc) > 0) {
          batch.set(k, op);
        }
      }

      const uniqueOps = Array.from(batch.values());
      const keys: Array<[string, string]> = uniqueOps.map((op) => [op.objectId, op.field]);

      await db.transaction("rw", db.registers, async () => {
        const existingRows = await db.registers.bulkGet(keys);
        const toPut: RegisterRow[] = [];

        for (let i = 0; i < uniqueOps.length; i++) {
          const op = uniqueOps[i]!;
          const existing = existingRows[i];
          if (existing === undefined || compareHlc(op.hlc, existing.hlc) > 0) {
            toPut.push({
              objectId: op.objectId,
              field: op.field,
              value: op.value,
              hlc: op.hlc,
            });
          }
        }

        if (toPut.length > 0) {
          await db.registers.bulkPut(toPut);
        }
      });
    },

    async outboxPut(ops: Op[]): Promise<void> {
      if (ops.length === 0) return;

      const batch = new Map<string, Op>();
      for (const op of ops) {
        const k = outboxKey(op.objectId, op.field);
        const prev = batch.get(k);
        if (prev === undefined || compareHlc(op.hlc, prev.hlc) > 0) {
          batch.set(k, op);
        }
      }

      const entries = Array.from(batch.entries());
      const keys = entries.map(([k]) => k);

      await db.transaction("rw", db.outbox, async () => {
        const existingRows = await db.outbox.bulkGet(keys);
        const toPut: OutboxRow[] = [];

        for (let i = 0; i < entries.length; i++) {
          const [key, op] = entries[i]!;
          const existing = existingRows[i];
          if (existing === undefined || compareHlc(op.hlc, existing.hlc) > 0) {
            toPut.push({
              key,
              objectId: op.objectId,
              field: op.field,
              value: op.value,
              hlc: op.hlc,
            });
          }
        }

        if (toPut.length > 0) {
          await db.outbox.bulkPut(toPut);
        }
      });
    },

    async outboxRemove(hlcs: HlcString[]): Promise<void> {
      if (hlcs.length === 0) return;

      await db.transaction("rw", db.outbox, async () => {
        await db.outbox.where("hlc").anyOf(hlcs).delete();
      });
    },

    async setMeta(patch: Partial<Meta>): Promise<void> {
      await db.transaction("rw", db.meta, async () => {
        const existing = await db.meta.get("singleton");
        const next: MetaRow = {
          id: "singleton",
          nodeId: patch.nodeId ?? existing?.nodeId ?? nodeId,
          lastSyncedSeq: patch.lastSyncedSeq ?? existing?.lastSyncedSeq ?? 0,
          lastHlc: patch.lastHlc !== undefined ? patch.lastHlc : (existing?.lastHlc ?? null),
        };
        await db.meta.put(next);
      });
    },

    async destroy(): Promise<void> {
      await db.delete();
    },
  };
}
