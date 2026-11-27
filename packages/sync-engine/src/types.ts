import type { ClientMessage, ServerMessage, SnapshotResponse } from "./protocol.js";

export type HlcString = string; // "{13-digit ms}:{5-digit counter}:{nodeId}"

export interface Hlc {
  physicalTime: number;
  counter: number;
  nodeId: string;
}

export type Point = [number, number];
export type FieldValue = string | number | boolean | null | Point[];

export interface Op {
  objectId: string;
  field: string;
  value: FieldValue;
  hlc: HlcString;
}

export interface Register {
  value: FieldValue;
  hlc: HlcString;
}

export type MergeResult =
  | { status: "ACCEPTED"; previous?: Register }
  | { status: "DISCARDED_STALE"; current: Register; reason: string };

// ---- Clock ----
export interface HlcClock {
  tick(): HlcString;
  receive(remote: HlcString): void;
  last(): HlcString;
}

export interface HlcClockOptions {
  nodeId: string;
  now: () => number;
  maxDriftMs?: number;
  initial?: HlcString;
}

// ---- CRDT ----
export type SnapshotState = Record<string, Record<string, Register>>;

export interface LwwMap {
  apply(op: Op): MergeResult;
  get(objectId: string, field: string): Register | undefined;
  getObject(objectId: string): Record<string, FieldValue> | undefined;
  visibleObjectIds(): string[];
  entries(): Iterable<[objectId: string, field: string, reg: Register]>;
  stateHash(): Promise<string>;
  toJSON(): SnapshotState;
}

// ---- Storage ----
export interface Meta {
  nodeId: string;
  lastSyncedSeq: number;
  lastHlc: HlcString | null;
}

export interface Storage {
  load(): Promise<{ state: SnapshotState; outbox: Op[]; meta: Meta }>;
  putRegisters(ops: Op[]): Promise<void>;
  outboxPut(ops: Op[]): Promise<void>;
  outboxRemove(hlcs: HlcString[]): Promise<void>;
  setMeta(patch: Partial<Meta>): Promise<void>;
  destroy(): Promise<void>;
}

// ---- Transport ----
export type ConnStatus = "online" | "connecting" | "offline";

export interface Transport {
  connect(): void;
  close(): void;
  send(msg: ClientMessage): void;
  onMessage(cb: (msg: ServerMessage) => void): () => void;
  onStatus(cb: (s: ConnStatus) => void): () => void;
  setOnline(online: boolean): void;
  setLatency(ms: number): void;
}

// ---- SyncClient events (Inspector + UI subscribe to these) ----
export type SyncEvent =
  | { kind: "local_op"; op: Op }
  | { kind: "remote_op"; op: Op; seq: number; result: MergeResult }
  | { kind: "sent"; ops: Op[] }
  | { kind: "acked"; hlcs: HlcString[]; seq: number }
  | { kind: "gap_detected"; expected: number; got: number }
  | { kind: "snapshot_required"; oldestAvailableSeq: number }
  | { kind: "outbox"; depth: number }
  | { kind: "status"; status: ConnStatus }
  | { kind: "error"; code: string; message: string };

export interface SyncClient {
  start(): Promise<void>;
  stop(): Promise<void>;
  mutate(changes: Array<Omit<Op, "hlc">>): Op[];
  readonly map: LwwMap;
  readonly status: ConnStatus;
  subscribeObject(objectId: string, cb: () => void): () => void;
  subscribeIds(cb: () => void): () => void;
  on(cb: (e: SyncEvent) => void): () => void;
  readonly transport: Transport;
}

export interface SyncClientOptions {
  boardId: string;
  nodeId: string;
  storage: Storage;
  transport: Transport;
  clock: HlcClock;
  flushIntervalMs?: number;
  /** Optional snapshot fetcher override (defaults to HTTP GET /api/v1/boards/{boardId}/snapshot). */
  fetchSnapshot?: () => Promise<SnapshotResponse>;
  /** Optional base URL for the default HTTP snapshot fetcher (e.g. "http://localhost:8080"). */
  apiBaseUrl?: string;
}
