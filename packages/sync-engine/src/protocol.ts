import type { HlcString, Op, SnapshotState } from "./types.js";

export type ObjectType = "rect" | "ellipse" | "arrow" | "freehand" | "text" | "diamond" | "sticky";

export type ArrowHead = "none" | "end" | "both";

export type ProtocolErrorCode =
  | "CLOCK_SKEW"
  | "INVALID_FIELD"
  | "FRAME_TOO_LARGE"
  | "BOARD_FULL"
  | "RATE_LIMITED"
  | "INVALID_MESSAGE"
  | "BOARD_NOT_FOUND";

export interface CursorPosition {
  x: number;
  y: number;
}

export interface SyncPushMessage {
  type: "SYNC_PUSH";
  clientId: string;
  ops: Op[];
}

export interface SyncPullMessage {
  type: "SYNC_PULL";
  lastSyncedSeq: number;
}

export interface PresenceMessage {
  type: "PRESENCE";
  clientId: string;
  displayName: string;
  color: string;
  cursor: CursorPosition | null;
  selectedIds: string[];
}

export interface SyncBroadcastMessage {
  type: "SYNC_BROADCAST";
  serverSeqStart: number;
  serverSeqEnd: number;
  originClientId: string;
  ops: Op[];
}

export interface SnapshotRequiredMessage {
  type: "SNAPSHOT_REQUIRED";
  oldestAvailableSeq: number;
}

export interface ErrorMessage {
  type: "ERROR";
  code: ProtocolErrorCode;
  message: string;
  /** HLCs of the ops that caused the rejection (CLOCK_SKEW, INVALID_FIELD, BOARD_FULL). */
  rejectedHlcs?: HlcString[];
}

export type ClientMessage = SyncPushMessage | SyncPullMessage | PresenceMessage;

export type ServerMessage =
  SyncBroadcastMessage | SnapshotRequiredMessage | ErrorMessage | PresenceMessage;

// ---- REST response contracts ----
export interface CreateBoardResponse {
  boardId: string;
  createdAt: string;
}

export interface SnapshotResponse {
  state: SnapshotState;
  snapshotSeq: number;
}

export interface SequencedOp {
  serverSeq: number;
  op: Op;
}

export interface OpsPageResponse {
  ops: SequencedOp[];
  hasMore: boolean;
}
