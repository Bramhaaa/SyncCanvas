import type { FieldValue, HlcString, Op, SyncClient } from "./types.js";

export interface UndoFieldDelta {
  objectId: string;
  field: string;
  /** Previous value before this mutation (undefined if register didn't exist yet). */
  beforeValue: FieldValue | undefined;
  afterValue: FieldValue;
  /** The HLC stamped by our local mutation, used for ownership checks before undoing. */
  writtenHlc: HlcString;
}

export interface UndoEntry {
  deltas: UndoFieldDelta[];
}

export interface UndoManager {
  /** Applies a batch of local changes via `client.mutate` and pushes them onto the undo stack. */
  mutate(changes: Array<Omit<Op, "hlc">>): Op[];
  /**
   * Records a batch of already-executed local ops (e.g. a completed drag from `beforeSnapshot`
   * to `afterOps`) as a single undoable step.
   */
  recordTransaction(deltas: UndoFieldDelta[]): void;
  /**
   * Undoes the most recent local transaction. Any field whose current register HLC no longer
   * matches `writtenHlc` (meaning a peer modified it since) is skipped — preserving peer edits!
   */
  undo(): Op[];
  /** Redoes the most recently undone transaction, also respecting peer ownership. */
  redo(): Op[];
  canUndo(): boolean;
  canRedo(): boolean;
  clear(): void;
  subscribe(cb: () => void): () => void;
}

const MAX_UNDO_DEPTH = 100;

export function createUndoManager(client: SyncClient): UndoManager {
  const undoStack: UndoEntry[] = [];
  const redoStack: UndoEntry[] = [];
  const listeners = new Set<() => void>();

  function notify(): void {
    for (const cb of listeners) {
      cb();
    }
  }

  return {
    mutate(changes: Array<Omit<Op, "hlc">>): Op[] {
      if (changes.length === 0) return [];

      // Capture before-values per (objectId, field) prior to mutating
      const beforeMap = new Map<string, FieldValue | undefined>();
      for (const ch of changes) {
        const key = `${ch.objectId}|${ch.field}`;
        if (!beforeMap.has(key)) {
          beforeMap.set(key, client.map.get(ch.objectId, ch.field)?.value);
        }
      }

      const ops = client.mutate(changes);
      // Coalesce repeated writes to the same (objectId, field) within this single batch
      const deltaByKey = new Map<string, UndoFieldDelta>();
      for (const op of ops) {
        const key = `${op.objectId}|${op.field}`;
        deltaByKey.set(key, {
          objectId: op.objectId,
          field: op.field,
          beforeValue: beforeMap.get(key),
          afterValue: op.value,
          writtenHlc: op.hlc,
        });
      }

      undoStack.push({ deltas: Array.from(deltaByKey.values()) });
      if (undoStack.length > MAX_UNDO_DEPTH) {
        undoStack.shift();
      }
      redoStack.length = 0;
      notify();
      return ops;
    },

    recordTransaction(deltas: UndoFieldDelta[]): void {
      if (deltas.length === 0) return;
      undoStack.push({ deltas });
      if (undoStack.length > MAX_UNDO_DEPTH) {
        undoStack.shift();
      }
      redoStack.length = 0;
      notify();
    },

    undo(): Op[] {
      const entry = undoStack.pop();
      if (!entry) return [];

      const revertChanges: Array<Omit<Op, "hlc">> = [];
      const appliedDeltas: UndoFieldDelta[] = [];

      // Check if this entry created a brand-new object (beforeValue of `type` was undefined)
      const createdObjects = new Set<string>();
      for (const d of entry.deltas) {
        if (d.field === "type" && d.beforeValue === undefined) {
          createdObjects.add(d.objectId);
        }
      }

      for (const objectId of createdObjects) {
        // Only soft-delete if no peer overwrote `deleted` or created fields after us?
        // Actually check ownership on every field of this transaction; for creation undo, tombstone it.
        const currentDeleted = client.map.get(objectId, "deleted");
        if (currentDeleted === undefined || currentDeleted.value !== true) {
          revertChanges.push({ objectId, field: "deleted", value: true });
          appliedDeltas.push({
            objectId,
            field: "deleted",
            beforeValue: true,
            afterValue: false,
            writtenHlc: "",
          });
        }
      }

      for (const d of entry.deltas) {
        if (createdObjects.has(d.objectId)) continue;
        // Ownership check: ONLY revert if our writtenHlc is still the winning register!
        const current = client.map.get(d.objectId, d.field);
        if (current === undefined || current.hlc !== d.writtenHlc) {
          continue;
        }
        if (d.beforeValue === undefined) {
          // Field didn't exist before (e.g. `deleted: true` on an undeleted object -> `deleted: false`)
          if (d.field === "deleted" && d.afterValue === true) {
            revertChanges.push({ objectId: d.objectId, field: "deleted", value: false });
            appliedDeltas.push({ ...d, beforeValue: false, afterValue: true });
          }
          continue;
        }
        revertChanges.push({ objectId: d.objectId, field: d.field, value: d.beforeValue });
        appliedDeltas.push({ ...d });
      }

      const ops = revertChanges.length > 0 ? client.mutate(revertChanges) : [];
      if (ops.length > 0) {
        const redoDeltas: UndoFieldDelta[] = [];
        for (let i = 0; i < ops.length; i++) {
          const op = ops[i]!;
          const src = appliedDeltas[i]!;
          redoDeltas.push({
            objectId: op.objectId,
            field: op.field,
            beforeValue: src.beforeValue,
            afterValue: src.afterValue,
            writtenHlc: op.hlc,
          });
        }
        redoStack.push({ deltas: redoDeltas });
      }

      notify();
      return ops;
    },

    redo(): Op[] {
      const entry = redoStack.pop();
      if (!entry) return [];

      const redoChanges: Array<Omit<Op, "hlc">> = [];
      const srcDeltas: UndoFieldDelta[] = [];

      for (const d of entry.deltas) {
        // Ownership check: only redo if nobody else modified the field since our undo!
        const current = client.map.get(d.objectId, d.field);
        if (current === undefined || current.hlc !== d.writtenHlc) {
          continue;
        }
        redoChanges.push({ objectId: d.objectId, field: d.field, value: d.afterValue });
        srcDeltas.push(d);
      }

      const ops = redoChanges.length > 0 ? client.mutate(redoChanges) : [];
      if (ops.length > 0) {
        const nextUndoDeltas: UndoFieldDelta[] = [];
        for (let i = 0; i < ops.length; i++) {
          const op = ops[i]!;
          const src = srcDeltas[i]!;
          nextUndoDeltas.push({
            objectId: op.objectId,
            field: op.field,
            beforeValue: src.beforeValue,
            afterValue: src.afterValue,
            writtenHlc: op.hlc,
          });
        }
        undoStack.push({ deltas: nextUndoDeltas });
      }

      notify();
      return ops;
    },

    canUndo(): boolean {
      return undoStack.length > 0;
    },

    canRedo(): boolean {
      return redoStack.length > 0;
    },

    clear(): void {
      undoStack.length = 0;
      redoStack.length = 0;
      notify();
    },

    subscribe(cb: () => void): () => void {
      listeners.add(cb);
      return () => {
        listeners.delete(cb);
      };
    },
  };
}
