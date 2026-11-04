import { afterEach, describe, expect, it, vi } from "vitest";
import { safeGetItem, safeRemoveItem, safeSetItem } from "./safe-storage";

function throwingStore(): Storage {
  const store = {
    getItem: () => {
      throw new Error("blocked");
    },
    setItem: () => {
      throw new Error("blocked");
    },
    removeItem: () => {
      throw new Error("blocked");
    },
  };
  return store as unknown as Storage;
}

describe("safe-storage", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("reads through when storage works", () => {
    vi.stubGlobal("window", { localStorage: { getItem: () => "v" } });
    expect(safeGetItem("k")).toBe("v");
  });

  it("returns null instead of throwing on a blocked read", () => {
    vi.stubGlobal("window", { localStorage: throwingStore() });
    expect(safeGetItem("k")).toBeNull();
  });

  it("reports write success honestly", () => {
    vi.stubGlobal("window", { localStorage: { setItem: () => {} } });
    expect(safeSetItem("k", "v")).toBe(true);
    vi.stubGlobal("window", { localStorage: throwingStore() });
    expect(safeSetItem("k", "v")).toBe(false);
    expect(safeRemoveItem("k")).toBe(false);
  });
});
