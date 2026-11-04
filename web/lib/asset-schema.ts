/**
 * Challenge-asset schema v2: visual-only stage dressing params. Parsing is
 * strict — exact keys, swatch allowlist, integer counts in bounds,
 * finite scales in range — so untrusted params can never smuggle
 * gameplay or crash the stage builders. Version 1 params still parse
 * and upgrade with quiet defaults, so older customs keep their look.
 */
import type { SwatchId } from "./stage3d";
import { isSwatchId } from "./stage3d";

export const ASSET_SCHEMA_VERSION = 2;

export interface AssetPalette {
  moon: SwatchId;
  crater: SwatchId;
  accent: SwatchId;
  crane: SwatchId;
}

/**
 * Decorative counts only. Rocks, vents, and flora on the terrain
 * strip stay bound to the match's geomorphology report — dressing
 * must never impersonate recorded data, so it gets its own
 * unmistakable festival pieces instead.
 */
export interface AssetScenery {
  trees: number;
  clouds: number;
  beacons: number;
  pennants: number;
  shrooms: number;
  lanterns: number;
}

export interface AssetMoon {
  craters: number;
  size: number;
  /** Ground-halo ring strength, 0 (off) to 1 (full). */
  halo: number;
}

export interface AssetTowers {
  heightScale: number;
  widthScale: number;
}

export interface ChallengeAssets {
  version: 2;
  palette: AssetPalette;
  scenery: AssetScenery;
  moon: AssetMoon;
  towers: AssetTowers;
}

/** The stage's undressed defaults, as valid v2 params. */
export const DEFAULT_ASSETS: ChallengeAssets = {
  version: 2,
  palette: { moon: "moon", crater: "crater", accent: "brand", crane: "gold" },
  scenery: { trees: 8, clouds: 4, beacons: 0, pennants: 0, shrooms: 0, lanterns: 0 },
  moon: { craters: 14, size: 1.0, halo: 0 },
  towers: { heightScale: 1.0, widthScale: 1.0 },
};

export type AssetParse =
  { ok: true; value: ChallengeAssets } | { ok: false; error: string };

const TOP_KEYS = ["version", "palette", "scenery", "moon", "towers"];
const PALETTE_KEYS = ["moon", "crater", "accent", "crane"];
const SCENERY_BOUNDS: Record<string, number> = {
  trees: 24,
  clouds: 8,
  beacons: 12,
  pennants: 20,
  shrooms: 16,
  lanterns: 12,
};
const V1_SCENERY_KEYS = ["trees", "clouds", "beacons", "pennants", "shrooms"];
const V1_MOON_KEYS = ["craters", "size"];
const V1_TOWERS_KEYS = ["heightScale"];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function exactKeys(value: Record<string, unknown>, keys: string[]): boolean {
  if (Object.keys(value).length !== keys.length) {
    return false;
  }
  return keys.every((key) => Object.prototype.hasOwnProperty.call(value, key));
}

function isCount(value: unknown, max: number): value is number {
  return Number.isInteger(value) && (value as number) >= 0 && (value as number) <= max;
}

function isScale(value: unknown, low: number, high: number): value is number {
  return (
    typeof value === "number" && Number.isFinite(value) && value >= low && value <= high
  );
}

export function parseChallengeAssets(data: unknown): AssetParse {
  if (!isRecord(data) || !exactKeys(data, TOP_KEYS)) {
    return {
      ok: false,
      error: "assets must hold version, palette, scenery, moon, towers",
    };
  }
  const legacy = data.version === 1;
  if (!legacy && data.version !== ASSET_SCHEMA_VERSION) {
    return { ok: false, error: "assets version must be 1 or 2" };
  }
  const palette = data.palette;
  if (!isRecord(palette) || !exactKeys(palette, PALETTE_KEYS)) {
    return { ok: false, error: "palette must hold moon, crater, accent, crane" };
  }
  for (const key of PALETTE_KEYS) {
    if (!isSwatchId(palette[key])) {
      return { ok: false, error: `unknown swatch for ${key}` };
    }
  }
  const scenery = data.scenery;
  const sceneryKeys = legacy ? V1_SCENERY_KEYS : Object.keys(SCENERY_BOUNDS);
  if (!isRecord(scenery) || !exactKeys(scenery, sceneryKeys)) {
    return {
      ok: false,
      error: legacy
        ? "scenery must hold trees, clouds, beacons, pennants, shrooms"
        : "scenery must hold trees, clouds, beacons, pennants, shrooms, lanterns",
    };
  }
  for (const [key, max] of Object.entries(SCENERY_BOUNDS)) {
    if (legacy && key === "lanterns") {
      continue;
    }
    if (!isCount(scenery[key], max)) {
      return { ok: false, error: `scenery.${key} count is out of bounds` };
    }
  }
  const moon = data.moon;
  const moonKeys = legacy ? V1_MOON_KEYS : [...V1_MOON_KEYS, "halo"];
  if (!isRecord(moon) || !exactKeys(moon, moonKeys)) {
    return {
      ok: false,
      error: legacy
        ? "moon must hold craters, size"
        : "moon must hold craters, size, halo",
    };
  }
  if (!isCount(moon.craters, 24)) {
    return { ok: false, error: "moon.craters count is out of bounds" };
  }
  if (!isScale(moon.size, 0.7, 1.4)) {
    return { ok: false, error: "moon.size scale is out of bounds" };
  }
  if (!legacy && !isScale(moon.halo, 0, 1)) {
    return { ok: false, error: "moon.halo scale is out of bounds" };
  }
  const towers = data.towers;
  const towerKeys = legacy ? V1_TOWERS_KEYS : [...V1_TOWERS_KEYS, "widthScale"];
  if (!isRecord(towers) || !exactKeys(towers, towerKeys)) {
    return {
      ok: false,
      error: legacy
        ? "towers must hold heightScale"
        : "towers must hold heightScale, widthScale",
    };
  }
  if (!isScale(towers.heightScale, 0.6, 1.6)) {
    return { ok: false, error: "towers.heightScale scale is out of bounds" };
  }
  if (!legacy && !isScale(towers.widthScale, 0.6, 1.6)) {
    return { ok: false, error: "towers.widthScale scale is out of bounds" };
  }
  return {
    ok: true,
    value: {
      version: 2,
      palette: {
        moon: palette.moon as SwatchId,
        crater: palette.crater as SwatchId,
        accent: palette.accent as SwatchId,
        crane: palette.crane as SwatchId,
      },
      scenery: {
        trees: scenery.trees as number,
        clouds: scenery.clouds as number,
        beacons: scenery.beacons as number,
        pennants: scenery.pennants as number,
        shrooms: scenery.shrooms as number,
        lanterns: legacy ? 0 : (scenery.lanterns as number),
      },
      moon: {
        craters: moon.craters,
        size: moon.size,
        halo: legacy ? 0 : (moon.halo as number),
      },
      towers: {
        heightScale: towers.heightScale,
        widthScale: legacy ? 1 : (towers.widthScale as number),
      },
    },
  };
}

/** Plain-words dressing summary for creator previews and trial cards. */
export function summarizeAssets(assets: ChallengeAssets): string {
  const parts = [
    `${String(assets.scenery.trees)} trees`,
    `${String(assets.scenery.clouds)} clouds`,
    `${String(assets.moon.craters)} craters`,
    `${assets.palette.crane} crane`,
    `${assets.palette.moon} disc`,
  ];
  if (assets.scenery.lanterns > 0) {
    parts.push(`${String(assets.scenery.lanterns)} lanterns`);
  }
  if (assets.moon.halo > 0) {
    parts.push("halo");
  }
  if (assets.towers.widthScale !== 1) {
    parts.push(assets.towers.widthScale > 1 ? "wide towers" : "slim towers");
  }
  return parts.join(" · ");
}
