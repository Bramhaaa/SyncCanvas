import { describe, expect, it } from "vitest";
import * as syncEngine from "@synccanvas/sync-engine";

describe("web scaffold", () => {
  it("resolves the @synccanvas/sync-engine workspace package", () => {
    expect(syncEngine).toBeDefined();
  });
});
