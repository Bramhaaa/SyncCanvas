// SyncCanvas sync-engine public entry point.
export type * from "./types.js";
export type * from "./protocol.js";
export { canonicalizeRegisters, computeStateHash } from "./hash.js";
export { ClockSkewError, compareHlc, createHlcClock, formatHlc, parseHlc } from "./hlc.js";
export { createLwwMap } from "./lww-map.js";
export { bringToFront, keyAbove, keyBetween, sendToBack } from "./zindex.js";
export { createEmitter, type Emitter } from "./emitter.js";
export {
  createMemoryStorage,
  createIndexedDbStorage,
  type MemoryStorageOptions,
  type IndexedDbStorageOptions,
} from "./storage/index.js";
export {
  createWebSocketTransport,
  createFakeServer,
  type FakeServer,
  type WebSocketConstructor,
  type WebSocketLike,
  type WebSocketTransportOptions,
} from "./transport/index.js";
export { createSyncClient } from "./sync-client.js";
export {
  colorFromNodeId,
  createPresenceClient,
  type PresenceClient,
  type PresenceClientOptions,
  type PresenceUpdate,
  type RemotePeer,
} from "./presence.js";
export {
  createUndoManager,
  type UndoEntry,
  type UndoFieldDelta,
  type UndoManager,
} from "./undo.js";
