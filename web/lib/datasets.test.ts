import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ASSET_PROMPT_MAX,
  buildAssetPrompt,
  datasetBridge,
  formatBytes,
  type DatasetFile,
} from "./datasets";

function file(overrides: Partial<DatasetFile> = {}): DatasetFile {
  return { rel: "runs.csv", size: 1200, kind: "tabular", ...overrides };
}

describe("datasetBridge", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("is null on plain web", () => {
    vi.stubGlobal("window", {});
    expect(datasetBridge()).toBeNull();
  });

  it("returns the preload bridge in Electron", () => {
    const bridge = {
      pick: () => Promise.resolve(null),
      import: () => Promise.reject(new Error("noop")),
      get: () => Promise.reject(new Error("noop")),
      remove: () => Promise.resolve(true),
    };
    vi.stubGlobal("window", { SimulatebyDamxStudio: { datasets: bridge } });
    expect(datasetBridge()).toBe(bridge);
  });

  it("reads null when the namespace lacks datasets", () => {
    vi.stubGlobal("window", { SimulatebyDamxStudio: {} });
    expect(datasetBridge()).toBeNull();
  });
});

describe("formatBytes", () => {
  it("scales through units", () => {
    expect(formatBytes(900)).toBe("900 B");
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatBytes(5 * 1024 * 1024)).toBe("5.0 MB");
  });

  it("floors garbage at zero", () => {
    expect(formatBytes(-4)).toBe("0 B");
    expect(formatBytes(Number.NaN)).toBe("0 B");
  });
});

describe("buildAssetPrompt", () => {
  it("appends the file list to the brief", () => {
    const prompt = buildAssetPrompt("Dress my city run", [
      file(),
      file({ rel: "tower.glb", size: 4096, kind: "model3d" }),
    ]);
    expect(prompt).toContain("Dress my city run");
    expect(prompt).toContain("- runs.csv (tabular, 1.2 KB)");
    expect(prompt).toContain("- tower.glb (model3d, 4.0 KB)");
  });

  it("limits the list to selected files", () => {
    const prompt = buildAssetPrompt(
      "Brief",
      [file(), file({ rel: "b.csv" })],
      ["b.csv"],
    );
    expect(prompt).not.toContain("runs.csv");
    expect(prompt).toContain("b.csv");
  });

  it("never exceeds the API limit", () => {
    const files = Array.from({ length: 300 }, (_, index) =>
      file({ rel: `file-${String(index)}.csv`, size: 10 }),
    );
    const prompt = buildAssetPrompt("Brief", files);
    expect(prompt.length).toBeLessThanOrEqual(ASSET_PROMPT_MAX);
    expect(prompt).toContain("…and");
    expect(prompt).toContain("more");
  });

  it("clips an overlong brief itself", () => {
    const prompt = buildAssetPrompt("x".repeat(5000), [file()]);
    expect(prompt.length).toBeLessThanOrEqual(ASSET_PROMPT_MAX);
  });
});
