import { createHlcClock } from "../../src/hlc.js";
import { createLwwMap } from "../../src/lww-map.js";
import type { FieldValue, HlcClock, LwwMap, Op } from "../../src/types.js";
import { bringToFront } from "../../src/zindex.js";

export interface Replica {
  readonly nodeId: string;
  readonly skewMs: number;
  readonly clock: HlcClock;
  readonly map: LwwMap;
}

export interface InFlightMessage {
  readonly from: number;
  readonly to: number;
  readonly op: Op;
}

export type SimMutation =
  | { kind: "create"; replica: number; objectId: string; x: number; y: number; fill: string }
  | { kind: "move"; replica: number; objectId: string; x: number; y: number }
  | { kind: "recolor"; replica: number; objectId: string; fill: string }
  | { kind: "delete"; replica: number; objectId: string }
  | { kind: "undelete"; replica: number; objectId: string }
  | { kind: "text"; replica: number; objectId: string; text: string };

export type NetworkAction =
  | { kind: "deliver"; index: number }
  | { kind: "duplicate"; index: number }
  | { kind: "drop_and_retry"; index: number }
  | { kind: "toggle_partition"; replica: number }
  | { kind: "advance_time"; dt: number };

export interface SimulatorOptions {
  replicaSkewsMs: number[];
  startTimeMs?: number;
  createMap?: () => LwwMap;
}

export class Simulator {
  readonly replicas: Replica[];
  private baseTimeMs: number;
  private readonly partitioned: Set<number> = new Set();
  private readonly inFlight: InFlightMessage[] = [];
  private readonly droppedRetryQueue: InFlightMessage[] = [];
  private _emittedOps = 0;

  constructor(options: SimulatorOptions) {
    this.baseTimeMs = options.startTimeMs ?? 1_732_579_200_000;
    const makeMap = options.createMap ?? (() => createLwwMap());

    this.replicas = options.replicaSkewsMs.map((skewMs, idx) => {
      const nodeId = `replica_${idx}`;
      return {
        nodeId,
        skewMs,
        clock: createHlcClock({
          nodeId,
          now: () => this.baseTimeMs + skewMs,
        }),
        map: makeMap(),
      };
    });
  }

  get emittedOps(): number {
    return this._emittedOps;
  }

  applyLocal(mutation: SimMutation): Op[] {
    const idx = mutation.replica % this.replicas.length;
    const rep = this.replicas[idx]!;
    const changes: Array<{ field: string; value: FieldValue }> = [];

    switch (mutation.kind) {
      case "create": {
        const allZ: string[] = [];
        for (const [, field, reg] of rep.map.entries()) {
          if (field === "zIndex" && typeof reg.value === "string") {
            allZ.push(reg.value);
          }
        }
        changes.push(
          { field: "type", value: "rect" },
          { field: "x", value: mutation.x },
          { field: "y", value: mutation.y },
          { field: "w", value: 100 },
          { field: "h", value: 60 },
          { field: "fill", value: mutation.fill },
          { field: "zIndex", value: bringToFront(allZ) },
        );
        break;
      }
      case "move":
        changes.push({ field: "x", value: mutation.x }, { field: "y", value: mutation.y });
        break;
      case "recolor":
        changes.push({ field: "fill", value: mutation.fill });
        break;
      case "delete":
        changes.push({ field: "deleted", value: true });
        break;
      case "undelete":
        changes.push({ field: "deleted", value: false });
        break;
      case "text":
        changes.push({ field: "text", value: mutation.text });
        break;
    }

    const ops: Op[] = changes.map(({ field, value }) => ({
      objectId: mutation.objectId,
      field,
      value,
      hlc: rep.clock.tick(),
    }));

    for (const op of ops) {
      rep.map.apply(op);
      this._emittedOps += 1;
      for (let target = 0; target < this.replicas.length; target++) {
        if (target !== idx) {
          this.inFlight.push({ from: idx, to: target, op });
        }
      }
    }

    return ops;
  }

  stepNetwork(action: NetworkAction): void {
    switch (action.kind) {
      case "advance_time":
        this.baseTimeMs += action.dt;
        return;
      case "toggle_partition": {
        const target = action.replica % this.replicas.length;
        if (this.partitioned.has(target)) {
          this.partitioned.delete(target);
        } else {
          this.partitioned.add(target);
        }
        return;
      }
      case "deliver": {
        if (this.inFlight.length === 0) return;
        const pos = action.index % this.inFlight.length;
        const msg = this.inFlight[pos]!;
        if (this.partitioned.has(msg.from) || this.partitioned.has(msg.to)) return;
        this.inFlight.splice(pos, 1);
        this.deliverToReplica(msg);
        return;
      }
      case "duplicate": {
        if (this.inFlight.length === 0) return;
        const pos = action.index % this.inFlight.length;
        const msg = this.inFlight[pos]!;
        this.inFlight.push(msg);
        return;
      }
      case "drop_and_retry": {
        if (this.inFlight.length === 0) return;
        const pos = action.index % this.inFlight.length;
        const [msg] = this.inFlight.splice(pos, 1);
        if (msg !== undefined) {
          this.droppedRetryQueue.push(msg);
        }
        return;
      }
    }
  }

  /**
   * Heals all partitions, requeues all dropped messages, and delivers every
   * remaining message to every replica.
   */
  healAndDrain(): void {
    this.partitioned.clear();
    while (this.droppedRetryQueue.length > 0) {
      this.inFlight.push(this.droppedRetryQueue.pop()!);
    }
    while (this.inFlight.length > 0) {
      const msg = this.inFlight.shift()!;
      this.deliverToReplica(msg);
    }
  }

  private deliverToReplica(msg: InFlightMessage): void {
    const target = this.replicas[msg.to]!;
    try {
      target.clock.receive(msg.op.hlc);
    } catch {
      // Per spec/protocol.md §2.6: clients always merge broadcast ops even if local clock lags.
    }
    target.map.apply(msg.op);
  }
}
