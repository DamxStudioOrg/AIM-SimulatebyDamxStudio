/**
 * Pure scene math for the canvas stages. No renderer imports here:
 * every layout derives from recorded sim data, so the same seed and
 * turn always build the same city, pack-out, and rank bars — and the
 * math stays unit-testable without a drawing context.
 */
import { CITY_KEYS, EVEN_SPLIT, allocationAt, mulberry32 } from "./city-scene";
import type { CityKey } from "./city-scene";
import type { ChartRow } from "./rank-chart";
import { TURNS, clamp01 } from "./replay-clock";
import type { EnvironmentReport, MatchTurn } from "./sim";
import { STAGE } from "./stage.tokens";

export interface StageContext {
  seed: number;
  kind: "city" | "tote";
  turns?: number;
  palette?: Partial<Record<keyof typeof PALETTE3D, number>>;
  scenery?: {
    moonCraters?: number;
    towersPerBudgetKey?: number;
    craneScale?: number;
  };
  dressing?: {
    kind?: "beacon" | "pennant" | "shroom";
    count?: number;
  };
}

/** Goofy low-poly stage palette (hex numbers for the iso painters). */
export const PALETTE3D = STAGE.PALETTE;

/**
 * Challenge-asset swatch ids: every key of the stage palette.
 * Keep in sync with sim/src/aim_sim/assets.py SWATCH_IDS and
 * server/app/Http/Controllers/ProposalController.php ASSET_SWATCHES.
 */
export const SWATCH_IDS = Object.keys(PALETTE3D);
export type SwatchId = keyof typeof PALETTE3D;

export function isSwatchId(value: unknown): value is SwatchId {
  return typeof value === "string" && SWATCH_IDS.includes(value);
}

/** Stage hex for a validated swatch id. */
export function swatchHex(id: SwatchId): number {
  return PALETTE3D[id];
}

/** The moon's ground: a cratered disc the models stand on. */
export const MOON_RADIUS = STAGE.MOON.RADIUS;

/** The companion: position, size, and one slow turn per 90 seconds. */
export const COMPANION = {
  x: STAGE.COMPANION.X,
  y: STAGE.COMPANION.Y,
  z: STAGE.COMPANION.Z,
  radius: STAGE.COMPANION.RADIUS,
  spin: STAGE.COMPANION.SPIN_PER_MS,
} as const;
const COMPANION_REST = STAGE.COMPANION.REST;

/** Companion spin angle: slow turn, frozen under reduced motion. */
export function companionAngle(timeMs: number, reduced: boolean): number {
  if (reduced) {
    return COMPANION_REST;
  }
  return COMPANION_REST + timeMs * COMPANION.spin;
}

/**
 * Moon–companion link: the circular simulation viewport is the
 * moon, and the big cratered sphere inside it is its companion.
 * As the moon grows (enlarge, full screen, wider window) the
 * companion shrinks, and vice versa; the paint loop eases the
 * scale so resizes read as orbital motion.
 */
export const MOON_REF_PX = STAGE.MOON.REF_PX;
const COMPANION_MIN = STAGE.COMPANION.MIN_SCALE;
const COMPANION_MAX = STAGE.COMPANION.MAX_SCALE;
const COMPANION_EASE = STAGE.COMPANION.EASE;

/** Companion scale factor for a moon width in CSS pixels. */
export function companionFactor(viewportPx: number): number {
  if (viewportPx <= 0) {
    return 1;
  }
  return Math.min(COMPANION_MAX, Math.max(COMPANION_MIN, MOON_REF_PX / viewportPx));
}

/** One step of the companion scale toward its target; snaps if reduced. */
export function companionStep(
  current: number,
  target: number,
  reduced: boolean,
): number {
  if (reduced) {
    return target;
  }
  return current + (target - current) * COMPANION_EASE;
}
const MOON_LIFT = STAGE.MOON.LIFT;

/** Point on the moon's front arc (towers, discs, crane lane). */
export function moonPoint(angle: number, radius: number): { x: number; z: number } {
  return { x: Math.sin(angle) * radius, z: Math.cos(angle) * radius - MOON_LIFT };
}

/** Point on the moon's back arc (terrain strip behind the towers). */
export function moonBackPoint(angle: number, radius: number): { x: number; z: number } {
  return { x: Math.sin(angle) * radius, z: MOON_LIFT - Math.cos(angle) * radius };
}

export const TOWER_ARC_R = STAGE.TOWER.ARC_R;
const TOWER_ARC_STEP = STAGE.TOWER.ARC_STEP;

/** Festival ring for challenge dressing: clear of towers and data strips. */
export const DRESS_RING_IN = STAGE.DRESS_RING.IN;
export const DRESS_RING_OUT = STAGE.DRESS_RING.OUT;

export type DressingKind = "beacon" | "pennant" | "shroom" | "lantern";

export interface DressingSpot {
  x: number;
  z: number;
  s: number;
  spin: number;
}

const DRESS_SALT: Record<DressingKind, number> = {
  beacon: 11,
  pennant: 101,
  shroom: 1001,
  lantern: 10001,
};

/**
 * Seeded dressing layout: `count` spots on the festival ring. Same
 * kind, count, and seed always lay the same spots, and longer counts
 * extend shorter ones, so dressing never reshuffles mid-design.
 */
export function dressingSpots(
  kind: DressingKind,
  count: number,
  seed: number,
): DressingSpot[] {
  if (!Number.isInteger(count) || count <= 0) {
    return [];
  }
  const rand = mulberry32(seed * 31 + DRESS_SALT[kind]);
  const spots: DressingSpot[] = [];
  for (let index = 0; index < count; index += 1) {
    const angle = rand() * Math.PI * 2;
    const radius = DRESS_RING_IN + rand() * (DRESS_RING_OUT - DRESS_RING_IN);
    spots.push({
      x: Math.sin(angle) * radius,
      z: Math.cos(angle) * radius,
      s: 0.8 + rand() * 0.5,
      spin: rand() * Math.PI * 2,
    });
  }
  return spots;
}

export interface VegetationMood {
  /** 0 = dust bowl, 1 = full canopy. Drives leaf tint and cactus count. */
  lush01: number;
  arid01: number;
}

/**
 * Vegetation mood from played turns: the mean green allocation share
 * sets lushness (an even 12.5 split reads ~0.6). Starve the parks
 * and the desert takes the grove back.
 */
export function vegetationMood(turns: MatchTurn[]): VegetationMood {
  if (turns.length === 0) {
    return { lush01: 0.6, arid01: 0.4 };
  }
  let green = 0;
  for (let turnNo = 1; turnNo <= turns.length; turnNo += 1) {
    green += allocationAt(turns, turnNo).green ?? 0;
  }
  const lush01 = clamp01(green / turns.length / STAGE.VEGETATION.LUSH_GREEN);
  return { lush01, arid01: 1 - lush01 };
}

export interface GroveSpot {
  x: number;
  z: number;
  s: number;
}

/**
 * Seeded spots on the tree strip behind the towers. Same count and
 * seed always lay the same grove; longer counts extend shorter
 * ones, so growth never reshuffles mid-design.
 */
export function groveSpots(count: number, seed: number, salt: number): GroveSpot[] {
  if (!Number.isInteger(count) || count <= 0) {
    return [];
  }
  const rand = mulberry32(seed * 31 + salt);
  const grove = STAGE.GROVE;
  const spots: GroveSpot[] = [];
  for (let index = 0; index < count; index += 1) {
    spots.push({
      x: grove.X_MIN + rand() * (grove.X_MAX - grove.X_MIN),
      z: grove.Z_MIN + rand() * (grove.Z_MAX - grove.Z_MIN),
      s: grove.SCALE_MIN + rand() * (grove.SCALE_MAX - grove.SCALE_MIN),
    });
  }
  return spots;
}

export interface HutSpot {
  x: number;
  z: number;
  rotY: number;
}

/**
 * The outhouse stands front-left or front-right of the towers (seed
 * picks the side), clear of the tower arc, turn discs, and crane
 * lane, facing the disc centre.
 */
export function hutSpot(seed: number): HutSpot {
  const side = mulberry32(seed * 17 + 3)() > 0.5 ? 1 : -1;
  const x = side * STAGE.HUT.X;
  const z = STAGE.HUT.Z;
  return { x, z, rotY: Math.atan2(0 - x, 0 - z) };
}

/** Where tower `index` of `count` stands on the moon's front arc. */
export function towerPosition(
  index: number,
  count: number,
): { x: number; z: number; angle: number } {
  const angle = (index - (count - 1) / 2) * TOWER_ARC_STEP;
  return { ...moonPoint(angle, TOWER_ARC_R), angle };
}

/** Candy tower paint: one loud flat color per budget key. */
export const TOWER_COLORS: Record<CityKey, number> = STAGE.TOWER_COLORS;

export const TOWER_GAP_X = 1.55;
export const DISC_GAP_X = 0.9;

const TOWER_BASE_H = 0.5;
const TOWER_PER_SHARE = 0.11;

export interface TowerShare {
  key: CityKey;
  share: number;
  height: number;
  x: number;
}

function shareAt(turns: MatchTurn[], turnNo: number, key: CityKey): number {
  return allocationAt(turns, turnNo)[key] ?? EVEN_SPLIT[key] ?? 0;
}

/**
 * Budget keys ranked by total share across the match, most first.
 * Stable: ties keep CITY_KEYS order, so the leaders never flicker
 * between frames. The stage labels only the top few.
 */
export function topKeysByTotal(turns: MatchTurn[], count: number): CityKey[] {
  return CITY_KEYS.map((key) => ({
    key,
    total: turns.reduce((sum, _, index) => sum + shareAt(turns, index + 1, key), 0),
  }))
    .sort((a, b) => b.total - a.total)
    .slice(0, Math.max(0, count))
    .map((entry) => entry.key);
}

/**
 * Tower shares at a fractional replay turn: interpolated while the
 * clock runs, frozen on the allocation of a selected (inspected) turn.
 */
export function towerShares(
  turns: MatchTurn[],
  turnFloat: number,
  selectedTurn: number | null,
  turnsCount: number = TURNS,
): TowerShare[] {
  return CITY_KEYS.map((key, index) => {
    let share: number;
    if (selectedTurn !== null) {
      share = shareAt(turns, selectedTurn, key);
    } else {
      const low = Math.max(1, Math.floor(turnFloat) + 1);
      const high = Math.min(turnsCount, low + 1);
      const frac = clamp01(turnFloat - Math.floor(turnFloat));
      share =
        shareAt(turns, low, key) +
        (shareAt(turns, high, key) - shareAt(turns, low, key)) * frac;
    }
    return {
      key,
      share,
      height: TOWER_BASE_H + share * TOWER_PER_SHARE,
      x: (index - (CITY_KEYS.length - 1) / 2) * TOWER_GAP_X,
    };
  });
}

/**
 * Shock windows mirror the retired 2D stage exactly: flood rides turns
 * 5-7, heat turns 9-11, with the same live/frozen split.
 */
export function shockKind(
  turnFloat: number,
  selectedTurn: number | null,
): "flood" | "heat" | null {
  if (selectedTurn !== null) {
    if (selectedTurn >= 5 && selectedTurn <= 7) {
      return "flood";
    }
    if (selectedTurn >= 9 && selectedTurn <= 11) {
      return "heat";
    }
    return null;
  }
  if (turnFloat >= 4 && turnFloat < 6.5) {
    return "flood";
  }
  if (turnFloat >= 8 && turnFloat < 10.5) {
    return "heat";
  }
  return null;
}

export interface TurnDisc {
  turn: number;
  x: number;
  z: number;
}

const DISC_ARC_R = 9.8;
const DISC_ARC_STEP = 0.052;

/** Turn markers along the moon's front arc; picks land here. */
export function turnDiscs(turns: number = TURNS): TurnDisc[] {
  return Array.from({ length: turns }, (_, index) => {
    const point = moonPoint((index - (turns - 1) / 2) * DISC_ARC_STEP, DISC_ARC_R);
    return { turn: index + 1, x: point.x, z: point.z };
  });
}

export interface SkylineBox {
  x: number;
  z: number;
  w: number;
  h: number;
  d: number;
  far: boolean;
}

/** Fit margin inside the disc chord for skyline rows (depth + air). */
const SKY_FIT_MARGIN = 2;

/** Deterministic background skyline: same seed, same city silhouette. */
export function skyline(seed: number): SkylineBox[] {
  const rand = mulberry32(seed * 7919 + 13);
  const boxes: SkylineBox[] = [];
  for (const layer of [
    { z: -13, far: true, count: 9 },
    { z: -8.5, far: false, count: 7 },
  ]) {
    // Same seeded draws in the same order — then the row centers in
    // its disc chord, squeezing uniformly only when it would spill.
    const drawn: { w: number; h: number; gap: number }[] = [];
    for (let i = 0; i < layer.count; i += 1) {
      drawn.push({
        w: 1.4 + rand() * 1.8,
        h: (layer.far ? 2.2 : 1.4) + rand() * (layer.far ? 3.4 : 2.2),
        gap: 0.5 + rand() * 0.9,
      });
    }
    const span = drawn.reduce(
      (sum, box, index) => sum + box.w + (index < drawn.length - 1 ? box.gap : 0),
      0,
    );
    const chord = Math.sqrt(Math.max(0, MOON_RADIUS * MOON_RADIUS - layer.z * layer.z));
    const fit = Math.min(1, ((chord - SKY_FIT_MARGIN) * 2) / span);
    let cursor = (-span * fit) / 2;
    for (const box of drawn) {
      const w = box.w * fit;
      boxes.push({
        x: cursor + w / 2,
        z: layer.z,
        w,
        h: box.h,
        d: 1.2,
        far: layer.far,
      });
      cursor += (box.w + box.gap) * fit;
    }
  }
  return boxes;
}

export const TOTE_TYPE_MS = 1500;
export const TOTE_ITEM_MS = 600;
export const CRATE_H = 0.62;

export interface ToteCrate {
  id: string;
  index: number;
  progress: number;
  landed: boolean;
  stackY: number;
  beltX: number;
}

/** Crate flight phases at pack-clock time t (ms), bottom-to-top order. */
export function toteCrates(
  packing: string[],
  weights: Map<string, number>,
  t: number,
): ToteCrate[] {
  return packing.map((id, index) => {
    const start = TOTE_TYPE_MS + index * TOTE_ITEM_MS;
    const progress = clamp01((t - start) / TOTE_ITEM_MS);
    return {
      id,
      index,
      progress,
      landed: progress >= 1,
      stackY: index * CRATE_H,
      beltX: -6 + index * 1.4,
    };
  });
}

/** Crate footprint grows with weight; heavy reads heavy. */
export function crateSize(weightKg: number): number {
  return 0.55 + Math.min(Math.max(weightKg, 0), 5) * 0.09;
}

export interface RankBar {
  position: number;
  name: string;
  value: number;
  height: number;
  x: number;
  leader: boolean;
  you: boolean;
}

const BAR_BASE_H = 0.3;
const BAR_PER_SHARE = 3.4;
export const BAR_GAP_X = 1.15;

/** Extruded rank bars from the same normalized rows the rail shows. */
export function rankBars(rows: ChartRow[]): RankBar[] {
  return rows.map((row, index) => ({
    position: row.position,
    name: row.name,
    value: row.value,
    height: BAR_BASE_H + row.width01 * BAR_PER_SHARE,
    x: (index - (rows.length - 1) / 2) * BAR_GAP_X,
    leader: row.position === 1,
    you: row.you,
  }));
}

/** Restoration overlay strength 0-1 across the window, fading at both ends. */
export function restorationAmount(turnFloat: number, turns: readonly number[]): number {
  const first = turns[0];
  const last = turns[turns.length - 1];
  if (first === undefined || last === undefined) {
    return 0;
  }
  const fade = 0.75;
  const inward = (turnFloat - (first - 1)) / fade;
  const outward = (last - turnFloat) / fade;
  return clamp01(Math.min(inward, outward, 1));
}

/** Deterministic site order matching the sim report. */
const SITE_ORDER = ["quarry", "aquifer", "vent"] as const;

export interface TerrainFeature {
  site: string;
  index: number;
  kind: "rock" | "vent" | "flora";
  x: number;
  z: number;
  scale: number;
  tilt: number;
}

const SITE_CENTRE_ANGLE: Record<string, number> = {
  quarry: -0.82,
  aquifer: 0,
  vent: 0.82,
};
const TERRAIN_ARC_R = 8.6;
const CELL_ARC_STEP = 0.048;

/** Feature scale from a 0-100 cell slope: steeper reads bigger. */
function slopeScale(slope: number): number {
  return 0.45 + (slope / 100) * 0.55;
}

/** Flora at or above a CACTUS_SLOPE grade grows cacti, not crowns. */
export function cactusCutoff(): number {
  return slopeScale(STAGE.VEGETATION.CACTUS_SLOPE);
}

/** Rocks, vents, and flora for the finished sites, along the back arc. */
export function terrainFeatures(
  environment: EnvironmentReport | undefined,
): TerrainFeature[] {
  if (environment === undefined) {
    return [];
  }
  const features: TerrainFeature[] = [];
  for (const site of SITE_ORDER) {
    const cells = environment.sites[site] ?? [];
    const centre = SITE_CENTRE_ANGLE[site] ?? 0;
    cells.forEach((cell, position) => {
      if (cell.feature === "barren") {
        return;
      }
      const rand = mulberry32(cell.index * 733 + site.length * 389 + 17);
      const angle = centre + (position - (cells.length - 1) / 2) * CELL_ARC_STEP;
      const point = moonBackPoint(angle, TERRAIN_ARC_R + rand() * 0.5);
      features.push({
        site,
        index: cell.index,
        kind: cell.feature,
        x: point.x,
        z: point.z,
        scale: slopeScale(cell.slope),
        tilt: (rand() - 0.5) * 0.5,
      });
    });
  }
  return features;
}

export const CRANE_ANGLE = 0.66;
export const CRANE_ARC_R = 8.4;
const CRANE_POINT = moonPoint(CRANE_ANGLE, CRANE_ARC_R);
export const CRANE_X = CRANE_POINT.x;
export const CRANE_Z = CRANE_POINT.z;
export const JIB_HEIGHT = 4.4;
export const JIB_ARM = 1.9;

const TOTE_ARC_R = 8.4;
const TOTE_CENTRE_ANGLE = 0.42;
const TOTE_ANGLE_SPREAD = 0.14;
const TOTE_BASE_Y = 0.52;
const HOOK_PARKED = 1.15;

/** Where the tote trailer hovers on the moon's front arc. */
export function toteHomePoint(): { x: number; z: number } {
  return moonPoint(TOTE_CENTRE_ANGLE, TOTE_ARC_R);
}

/** Where the crate pallet waits, on the crane's other side. */
export function palletPoint(): { x: number; z: number } {
  return moonPoint(0.92, TOTE_ARC_R);
}

export interface CranePose {
  toteX: number;
  toteZ: number;
  toteY: number;
  toteLift: number;
  jibAngle: number;
  cableLength: number;
  hooked: boolean;
}

/**
 * Goofy construction choreography: a tote-bag dump trailer levitates
 * along the moon's front arc; the crane swivels to track it, drops its cable to
 * the tote handle as it passes the hook point, lifts it briefly, and
 * lets it drift on. Reduced motion parks it mid-lift.
 */
export function cranePose(timeMs: number, reduced: boolean): CranePose {
  const drift = reduced ? 0 : Math.sin(timeMs / 5200);
  const totePoint = moonPoint(
    TOTE_CENTRE_ANGLE + drift * TOTE_ANGLE_SPREAD,
    TOTE_ARC_R,
  );
  const align = clamp01(1 - Math.abs(drift) * 1.7);
  const toteLift = align * align * 0.95;
  const bob = reduced ? 0 : Math.sin(timeMs / 640) * 0.07;
  const toteY = TOTE_BASE_Y + bob + toteLift;
  const hookReach = JIB_HEIGHT - (toteY + 0.95);
  return {
    toteX: totePoint.x,
    toteZ: totePoint.z,
    toteY,
    toteLift,
    jibAngle: Math.atan2(totePoint.x - CRANE_X, totePoint.z - CRANE_Z),
    cableLength: HOOK_PARKED + (hookReach - HOOK_PARKED) * align,
    hooked: align > 0.55,
  };
}

export function mergeStageContext(
  base: StageContext,
  overrides?: Partial<StageContext>,
): StageContext {
  if (!overrides) return base;
  return {
    ...base,
    ...overrides,
    palette: { ...base.palette, ...(overrides.palette ?? {}) },
    scenery: { ...base.scenery, ...(overrides.scenery ?? {}) },
    dressing: { ...base.dressing, ...(overrides.dressing ?? {}) },
  };
}
