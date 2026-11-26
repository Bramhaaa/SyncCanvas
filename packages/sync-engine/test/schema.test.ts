import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Ajv2020 } from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";

const schemaDir = join(dirname(fileURLToPath(import.meta.url)), "../../../spec/schema");
const ajv = new Ajv2020({ allErrors: true, strict: true });
for (const file of readdirSync(schemaDir)) {
  ajv.addSchema(JSON.parse(readFileSync(join(schemaDir, file), "utf8")));
}

const validate = (name: string, msg: unknown): boolean => {
  const fn = ajv.getSchema(`https://synccanvas.dev/schema/${name}.schema.json`);
  if (!fn) throw new Error(`schema ${name} not found`);
  return fn(msg) as boolean;
};

const hlc = "1732579200450:00000:user_a_9f2";
const op = { objectId: "obj_91f2a7k3m0", field: "x", value: 420.5, hlc };

describe("spec/schema", () => {
  it.each<[string, unknown]>([
    ["sync-push", { type: "SYNC_PUSH", clientId: "user_a_9f2", ops: [op] }],
    [
      "sync-push",
      {
        type: "SYNC_PUSH",
        clientId: "a",
        ops: [
          {
            objectId: "obj_1",
            field: "points",
            value: [
              [0, 0],
              [1.5, 2],
            ],
            hlc,
          },
        ],
      },
    ],
    [
      "sync-broadcast",
      {
        type: "SYNC_BROADCAST",
        serverSeqStart: 1,
        serverSeqEnd: 1,
        originClientId: "server",
        ops: [op],
      },
    ],
    ["sync-pull", { type: "SYNC_PULL", lastSyncedSeq: 0 }],
    ["snapshot-required", { type: "SNAPSHOT_REQUIRED", oldestAvailableSeq: 5200 }],
    ["error", { type: "ERROR", code: "INVALID_FIELD", message: "bad", rejectedHlcs: [hlc] }],
    ["error", { type: "ERROR", code: "FRAME_TOO_LARGE", message: "too big" }],
    [
      "presence",
      {
        type: "PRESENCE",
        clientId: "user_a_9f2",
        displayName: "User A",
        color: "#EF4444",
        cursor: { x: 512, y: 304 },
        selectedIds: ["obj_91f2a7k3m0"],
      },
    ],
    [
      "presence",
      {
        type: "PRESENCE",
        clientId: "user_a_9f2",
        displayName: "User A",
        color: "#EF4444",
        cursor: null,
        selectedIds: [],
      },
    ],
  ])("accepts valid %s", (name, msg) => {
    expect(validate(name, msg)).toBe(true);
  });

  it.each<[string, string, unknown]>([
    ["sync-push", "empty ops", { type: "SYNC_PUSH", clientId: "a", ops: [] }],
    ["sync-push", "uppercase clientId", { type: "SYNC_PUSH", clientId: "User", ops: [op] }],
    [
      "sync-push",
      "bad objectId",
      { type: "SYNC_PUSH", clientId: "a", ops: [{ ...op, objectId: "Rect-1" }] },
    ],
    [
      "sync-push",
      "bad field name",
      { type: "SYNC_PUSH", clientId: "a", ops: [{ ...op, field: "a.b" }] },
    ],
    ["sync-push", "bad hlc", { type: "SYNC_PUSH", clientId: "a", ops: [{ ...op, hlc: "1:2:a" }] }],
    [
      "sync-push",
      "3-tuple point",
      { type: "SYNC_PUSH", clientId: "a", ops: [{ ...op, value: [[1, 2, 3]] }] },
    ],
    ["sync-push", "extra property", { type: "SYNC_PUSH", clientId: "a", ops: [op], extra: 1 }],
    ["sync-pull", "negative seq", { type: "SYNC_PULL", lastSyncedSeq: -1 }],
    ["error", "unknown code", { type: "ERROR", code: "NOPE", message: "x" }],
  ])("rejects %s with %s", (name, _label, msg) => {
    expect(validate(name, msg)).toBe(false);
  });
});
