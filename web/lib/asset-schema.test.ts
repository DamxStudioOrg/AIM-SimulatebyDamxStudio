import { describe, expect, it } from "vitest";
import { SWATCH_IDS } from "./stage3d";
import { DEFAULT_ASSETS, parseChallengeAssets, summarizeAssets } from "./asset-schema";

function valid(): Record<string, unknown> {
  return {
    version: 2,
    palette: { moon: "moon", crater: "crater", accent: "brand", crane: "gold" },
    scenery: {
      trees: 12,
      clouds: 4,
      beacons: 6,
      pennants: 10,
      shrooms: 5,
      lanterns: 3,
    },
    moon: { craters: 14, size: 1.0, halo: 0.5 },
    towers: { heightScale: 1.0, widthScale: 1.2 },
  };
}

function legacy(): Record<string, unknown> {
  return {
    version: 1,
    palette: { moon: "moon", crater: "crater", accent: "brand", crane: "gold" },
    scenery: { trees: 12, clouds: 4, beacons: 6, pennants: 10, shrooms: 5 },
    moon: { craters: 14, size: 1.0 },
    towers: { heightScale: 1.0 },
  };
}

describe("parseChallengeAssets", () => {
  it("accepts exact-shape v2 params", () => {
    const parsed = parseChallengeAssets(valid());
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.value.palette.crane).toBe("gold");
      expect(parsed.value.scenery.lanterns).toBe(3);
      expect(parsed.value.moon.halo).toBe(0.5);
      expect(parsed.value.towers.widthScale).toBe(1.2);
    }
  });

  it("upgrades v1 params with quiet defaults", () => {
    const parsed = parseChallengeAssets(legacy());
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.value.version).toBe(2);
      expect(parsed.value.scenery.trees).toBe(12);
      expect(parsed.value.scenery.lanterns).toBe(0);
      expect(parsed.value.moon.halo).toBe(0);
      expect(parsed.value.towers.widthScale).toBe(1);
    }
  });

  it("rejects non-objects, wrong versions, and missing sections", () => {
    expect(parseChallengeAssets(null).ok).toBe(false);
    expect(parseChallengeAssets("dressing").ok).toBe(false);
    expect(parseChallengeAssets({ ...valid(), version: 3 }).ok).toBe(false);
    expect(parseChallengeAssets({ ...valid(), version: "2" }).ok).toBe(false);
    const missing = valid();
    delete missing.moon;
    expect(parseChallengeAssets(missing).ok).toBe(false);
  });

  it("rejects v1 params carrying v2 keys and vice versa", () => {
    const smuggled = legacy();
    (smuggled.scenery as Record<string, unknown>).lanterns = 2;
    expect(parseChallengeAssets(smuggled).ok).toBe(false);
    const stripped = valid();
    delete (stripped.towers as Record<string, unknown>).widthScale;
    expect(parseChallengeAssets(stripped).ok).toBe(false);
  });

  it("rejects gameplay smuggling through unknown keys", () => {
    expect(parseChallengeAssets({ ...valid(), gameplay: { shocks: 9 } }).ok).toBe(
      false,
    );
    const nested = valid();
    (nested.scenery as Record<string, unknown>).shocks = 9;
    expect(parseChallengeAssets(nested).ok).toBe(false);
  });

  it("rejects unknown swatches", () => {
    const params = valid();
    (params.palette as Record<string, unknown>).accent = "javascript:alert(1)";
    const parsed = parseChallengeAssets(params);
    expect(parsed.ok).toBe(false);
  });

  it("rejects out-of-range and fractional counts", () => {
    for (const [key, bad] of [
      ["trees", -1],
      ["trees", 25],
      ["clouds", 9],
      ["beacons", 13],
      ["pennants", 21],
      ["shrooms", 17],
      ["lanterns", 13],
      ["trees", 2.5],
      ["trees", true],
    ] as const) {
      const params = valid();
      (params.scenery as Record<string, unknown>)[key] = bad;
      expect(parseChallengeAssets(params).ok).toBe(false);
    }
  });

  it("rejects out-of-range and non-finite scales", () => {
    const big = valid();
    (big.moon as Record<string, unknown>).size = 1.5;
    expect(parseChallengeAssets(big).ok).toBe(false);
    const flat = valid();
    (flat.towers as Record<string, unknown>).heightScale = 0.5;
    expect(parseChallengeAssets(flat).ok).toBe(false);
    const infinite = valid();
    (infinite.moon as Record<string, unknown>).size = Number.POSITIVE_INFINITY;
    expect(parseChallengeAssets(infinite).ok).toBe(false);
    const halo = valid();
    (halo.moon as Record<string, unknown>).halo = 1.5;
    expect(parseChallengeAssets(halo).ok).toBe(false);
    const wide = valid();
    (wide.towers as Record<string, unknown>).widthScale = 0.5;
    expect(parseChallengeAssets(wide).ok).toBe(false);
  });

  it("keeps the swatch set at the documented sixteen", () => {
    expect([...SWATCH_IDS].sort()).toEqual(
      [
        "brand",
        "coral",
        "crater",
        "far",
        "gold",
        "grape",
        "ground",
        "heat",
        "ink",
        "leader",
        "mid",
        "mint",
        "moon",
        "sky",
        "street",
        "water",
      ].sort(),
    );
  });
});

describe("summarizeAssets", () => {
  it("names the dressing in plain words", () => {
    const parsed = parseChallengeAssets(valid());
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      const summary = summarizeAssets(parsed.value);
      expect(summary).toContain("12 trees");
      expect(summary).toContain("14 craters");
      expect(summary).toContain("gold crane");
      expect(summary).toContain("3 lanterns");
      expect(summary).toContain("halo");
      expect(summary).toContain("wide towers");
    }
  });
});

describe("DEFAULT_ASSETS", () => {
  it("is itself valid", () => {
    expect(parseChallengeAssets(DEFAULT_ASSETS).ok).toBe(true);
  });
});
