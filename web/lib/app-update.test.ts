import { afterEach, describe, expect, it, vi } from "vitest";

import {
  WEEK_MS,
  checkDue,
  checkForUpdate,
  compareVersions,
  currentVersion,
  fetchShipped,
  parseDownloads,
  parseVersion,
} from "./app-update";

function jsonResponse(body: unknown, ok = true): Response {
  return {
    ok,
    json: () => Promise.resolve(body),
  } as Response;
}

describe("parseVersion", () => {
  it("parses strict triples", () => {
    expect(parseVersion("0.1.0")).toEqual([0, 1, 0]);
    expect(parseVersion(" 10.2.30 ")).toEqual([10, 2, 30]);
  });

  it("rejects anything else", () => {
    for (const bad of ["1.2", "v1.2.3", "1.2.3.4", "1.2.x", "", "1.2.-3"]) {
      expect(parseVersion(bad)).toBeNull();
    }
  });
});

describe("compareVersions", () => {
  it("orders by major, minor, then patch", () => {
    expect(compareVersions("0.1.0", "0.1.0")).toBe(0);
    expect(compareVersions("0.1.0", "0.2.0") ?? 0).toBeLessThan(0);
    expect(compareVersions("1.0.0", "0.9.9") ?? 0).toBeGreaterThan(0);
    expect(compareVersions("0.1.1", "0.1.0") ?? 0).toBeGreaterThan(0);
  });

  it("reads null when either side is unparseable", () => {
    expect(compareVersions("0.1.0", "soon")).toBeNull();
    expect(compareVersions("soon", "0.1.0")).toBeNull();
  });
});

describe("checkDue", () => {
  it("is due when never checked, garbled, or a week old", () => {
    const now = Date.parse("2026-11-04T00:00:00.000Z");
    expect(checkDue(null, now)).toBe(true);
    expect(checkDue("", now)).toBe(true);
    expect(checkDue("not-a-date", now)).toBe(true);
    expect(checkDue(new Date(now - WEEK_MS).toISOString(), now)).toBe(true);
    expect(checkDue(new Date(now - WEEK_MS + 1000).toISOString(), now)).toBe(false);
  });
});

describe("fetchShipped", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns the shipped triple on ok", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(
          jsonResponse({ version: "0.2.0", url: "https://x.test", notes: "" }),
        ),
      ),
    );
    await expect(fetchShipped()).resolves.toEqual({
      version: "0.2.0",
      url: "https://x.test",
      notes: "",
    });
  });

  it("throws honestly on transport, status, and shape failures", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new Error("down"))),
    );
    await expect(fetchShipped()).rejects.toThrow("update server unreachable");

    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(jsonResponse({ error: "bad query" }, false))),
    );
    await expect(fetchShipped()).rejects.toThrow("bad query");

    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(jsonResponse({ version: "0.2.0" }))),
    );
    await expect(fetchShipped()).rejects.toThrow("bad payload");
  });

  it("rejects a release URL that is not absolute http(s)", async () => {
    for (const url of ["javascript:alert(1)", "/releases", "ftp://x.test/a"]) {
      vi.stubGlobal(
        "fetch",
        vi.fn(() =>
          Promise.resolve(jsonResponse({ version: "0.2.0", url, notes: "" })),
        ),
      );
      await expect(fetchShipped()).rejects.toThrow("bad payload");
    }
  });
});

describe("parseDownloads", () => {
  const good = {
    mac: "https://board.test/downloads/simulate-macos.dmg",
    windows: "https://board.test/downloads/simulate-windows.exe",
    linux: "https://board.test/downloads/simulate-linux.AppImage",
  };

  it("accepts a full http(s) map", () => {
    expect(parseDownloads(good)).toEqual(good);
  });

  it("voids the map on any missing or non-http entry", () => {
    expect(parseDownloads(null)).toBeNull();
    expect(parseDownloads({ ...good, linux: undefined })).toBeNull();
    expect(parseDownloads({ ...good, mac: "javascript:alert(1)" })).toBeNull();
    expect(parseDownloads({ ...good, windows: "not a url" })).toBeNull();
  });
});

describe("fetchShipped downloads", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("carries a valid map and drops a bad one", async () => {
    const body = {
      version: "0.2.0",
      url: "https://x.test",
      notes: "",
      downloads: {
        mac: "https://x.test/d/s-mac.dmg",
        windows: "https://x.test/d/s-win.exe",
        linux: "https://x.test/d/s-lin.AppImage",
      },
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(jsonResponse(body))),
    );
    const withMap = await fetchShipped();
    expect(withMap.downloads).toEqual(body.downloads);

    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(jsonResponse({ ...body, downloads: { mac: "x" } }))),
    );
    const withoutMap = await fetchShipped();
    expect(withoutMap.downloads).toBeUndefined();
  });
});

describe("currentVersion", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.NEXT_PUBLIC_APP_VERSION;
  });

  it("prefers the desktop bridge", async () => {
    vi.stubGlobal("window", {
      SimulatebyDamxStudio: { getVersion: () => Promise.resolve("0.1.0") },
    });
    process.env.NEXT_PUBLIC_APP_VERSION = "9.9.9";
    await expect(currentVersion()).resolves.toBe("0.1.0");
  });

  it("falls back to the stamped env, then null", async () => {
    vi.stubGlobal("window", {});
    process.env.NEXT_PUBLIC_APP_VERSION = "0.3.0";
    await expect(currentVersion()).resolves.toBe("0.3.0");
    delete process.env.NEXT_PUBLIC_APP_VERSION;
    await expect(currentVersion()).resolves.toBeNull();
  });

  it("survives a throwing bridge", async () => {
    vi.stubGlobal("window", {
      SimulatebyDamxStudio: {
        getVersion: () => Promise.reject(new Error("no main")),
      },
    });
    process.env.NEXT_PUBLIC_APP_VERSION = "0.3.0";
    await expect(currentVersion()).resolves.toBe("0.3.0");
  });
});

describe("checkForUpdate", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.NEXT_PUBLIC_APP_VERSION;
  });

  it("reports available, current, and failed distinctly", async () => {
    vi.stubGlobal("window", {
      SimulatebyDamxStudio: { getVersion: () => Promise.resolve("0.1.0") },
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(
          jsonResponse({ version: "0.2.0", url: "https://x.test", notes: "Hi." }),
        ),
      ),
    );
    const behind = await checkForUpdate();
    expect(behind.state).toBe("available");

    vi.stubGlobal("window", {
      SimulatebyDamxStudio: { getVersion: () => Promise.resolve("0.2.0") },
    });
    const even = await checkForUpdate();
    expect(even.state).toBe("current");

    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new Error("down"))),
    );
    const failed = await checkForUpdate();
    expect(failed).toEqual({ state: "failed", error: "update server unreachable" });
  });

  it("admits an unknown running version", async () => {
    vi.stubGlobal("window", {});
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(
          jsonResponse({ version: "0.2.0", url: "https://x.test", notes: "" }),
        ),
      ),
    );
    await expect(checkForUpdate()).resolves.toEqual({ state: "unknown-version" });
  });
});
