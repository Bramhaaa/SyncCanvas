import { describe, expect, it } from "vitest";
import * as syncEngine from "../src/index.js";

describe("sync-engine scaffold", () => {
  it("loads the package entry point", () => {
    expect(syncEngine).toBeDefined();
  });
});
