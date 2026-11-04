/**
 * Mini-MCP render surface: SceneJSON v1, describe, paint, tools.
 *
 * The deal: models read and write scene-graph JSON, the stage paints
 * it. `describeCityScene`/`describeToteScene` turn match payloads
 * into scenes with the same stage3d layout math the old 3D used, so
 * the 2D view can never drift from the sim. `renderScene` paints any
 * valid scene onto a 2D canvas. `placeProp`/`listProps`/
 * `parseSceneJSON` are the model-facing tools, with JSON schemas in
 * RENDER_TOOLS ready for an MCP-server transport later. Rendering
 * itself stays client-side: models ship scene JSON, not pixels.
 *
 * Prop numeric fields have per-kind meaning (documented once here):
 * size = uniform scale (tower footprint scalar, tree scale, disc
 * radius scalar, companion scale, crate footprint scalar, water
 * radius); height = extrusion (towers, skyline, crane mast,
 * crates use 0.42 fixed); angle = yaw spin (crane jib, hut facing,
 * companion spin, dressing spin); length = cable span (crane) or
 * crater count (companion). color/colorTop are hex ints; label and
 * state are short strings; alpha is 0-1 opacity.
 */

import type { ChallengeAssets } from "./asset-schema";
import { mulberry32 } from "./city-scene";
import {
  ball,
  depthKey,
  fitCamera,
  isoBox,
  isoDisc,
  isoDiscRadii,
  line,
  poly,
  project,
  shade,
  toCss,
  vline,
} from "./iso";
import type { Ctx, IsoBounds, IsoCamera, IsoView } from "./iso";
import { ISO_VIEW_FLAT } from "./iso";
import { FONT, clamp01, turnAt } from "./replay-clock";
import { STAGE } from "./stage.tokens";
import {
  COMPANION,
  CRANE_X,
  CRANE_Z,
  JIB_ARM,
  JIB_HEIGHT,
  MOON_RADIUS,
  PALETTE3D,
  TOWER_COLORS,
  cactusCutoff,
  cranePose,
  crateSize,
  dressingSpots,
  groveSpots,
  hutSpot,
  palletPoint,
  restorationAmount,
  shockKind,
  skyline,
  swatchHex,
  terrainFeatures,
  topKeysByTotal,
  toteCrates,
  toteHomePoint,
  towerPosition,
  towerShares,
  turnDiscs,
  vegetationMood,
} from "./stage3d";
import type { DressingKind } from "./stage3d";
import type { MatchResultPayload, ToteCatalog, TotePackResult } from "./sim";

export const SCENE_SCHEMA_VERSION = 1;

const PROP_KINDS = [
  "tower",
  "disc",
  "skyline",
  "crane",
  "hook",
  "tote",
  "hut",
  "tree",
  "pine",
  "cactus",
  "rock",
  "vent",
  "puff",
  "cloudpuff",
  "companion",
  "beacon",
  "pennant",
  "shroom",
  "lantern",
  "pallet",
  "crate",
  "water",
  "veil",
] as const;

export type PropKind = (typeof PROP_KINDS)[number];

function isPropKind(value: unknown): value is PropKind {
  return typeof value === "string" && (PROP_KINDS as readonly string[]).includes(value);
}

export interface SceneProp {
  id: string;
  kind: PropKind;
  x: number;
  z: number;
  y: number;
  size: number;
  height: number;
  color: number;
  colorTop: number | null;
  label: string;
  state: string;
  alpha: number;
  angle: number;
  length: number;
}

export type SceneShock = "flood" | "heat" | null;
export type SceneGame = "city" | "tote";
export type WeatherKind = "rain" | "heat" | "seismic" | null;

export interface SceneWeather {
  kind: WeatherKind;
  amount: number;
  shakeX: number;
  shakeY: number;
}

export interface SceneJSON {
  version: 1;
  game: SceneGame;
  seed: number;
  turn: number;
  shock: SceneShock;
  progress01: number;
  t: number;
  ground: { disc: number; dots: number; seed: number; halo: number };
  weather: SceneWeather;
  rain: { x: number; y: number; z: number }[] | null;
  props: SceneProp[];
}

/** Short tower labels, single source (the old 3D kept its own copy). */
export const KEY_SHORT: Record<string, string> = {
  housing: "HOUSE",
  transit: "BUS",
  health: "MED",
  green: "PARK",
  reserves: "VAULT",
  rescue: "AID",
  shelter: "TENT",
  repair: "FIX",
};

/** lerp two hex colors in RGB, like THREE.Color.lerpColors. */
export function lerpHex(a: number, b: number, t: number): number {
  const mix = (shift: number): number => {
    const ca = (a >> shift) & 0xff;
    const cb = (b >> shift) & 0xff;
    return Math.round(ca + (cb - ca) * clamp01(t));
  };
  return (mix(16) << 16) | (mix(8) << 8) | mix(0);
}

export function cssToHex(css: string): number {
  const parsed = Number.parseInt(css.replace("#", ""), 16);
  return Number.isInteger(parsed) && parsed >= 0 && parsed <= 0xffffff
    ? parsed
    : 0xffffff;
}

export type SceneParse = { ok: true; value: SceneJSON } | { ok: false; error: string };

const TOP_KEYS = [
  "version",
  "game",
  "seed",
  "turn",
  "shock",
  "progress01",
  "t",
  "ground",
  "weather",
  "rain",
  "props",
];
const PROP_KEYS = [
  "id",
  "kind",
  "x",
  "z",
  "y",
  "size",
  "height",
  "color",
  "colorTop",
  "label",
  "state",
  "alpha",
  "angle",
  "length",
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function exactKeys(value: Record<string, unknown>, keys: string[]): boolean {
  if (Object.keys(value).length !== keys.length) {
    return false;
  }
  return keys.every((key) => Object.prototype.hasOwnProperty.call(value, key));
}

function isSubsetKeys(value: Record<string, unknown>, keys: string[]): boolean {
  return Object.keys(value).every((key) => keys.includes(key));
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isHex(value: unknown): value is number {
  return (
    Number.isInteger(value) && (value as number) >= 0 && (value as number) <= 0xffffff
  );
}

function fail(error: string): SceneParse {
  return { ok: false, error };
}

function parseProp(data: unknown): SceneProp | null {
  if (!isRecord(data) || !isSubsetKeys(data, PROP_KEYS)) {
    return null;
  }
  const { id, kind, x, z } = data;
  if (
    typeof id !== "string" ||
    id.length === 0 ||
    id.length > 48 ||
    !isPropKind(kind) ||
    !isFiniteNumber(x) ||
    !isFiniteNumber(z)
  ) {
    return null;
  }
  const opt = (key: string, check: (v: unknown) => boolean): boolean => {
    const value = data[key];
    return value === undefined || check(value);
  };
  const isShort =
    (max: number) =>
    (value: unknown): value is string =>
      typeof value === "string" && value.length <= max;
  if (
    !opt("y", isFiniteNumber) ||
    !opt("size", isFiniteNumber) ||
    !opt("height", isFiniteNumber) ||
    !opt("color", isHex) ||
    !opt("colorTop", (v) => v === null || isHex(v)) ||
    !opt("label", isShort(24)) ||
    !opt("state", isShort(16)) ||
    !opt("alpha", (v) => isFiniteNumber(v) && v >= 0 && v <= 1) ||
    !opt("angle", isFiniteNumber) ||
    !opt("length", isFiniteNumber)
  ) {
    return null;
  }
  return {
    id,
    kind,
    x,
    z,
    y: isFiniteNumber(data.y) ? data.y : 0,
    size: isFiniteNumber(data.size) ? data.size : 1,
    height: isFiniteNumber(data.height) ? data.height : 1,
    color: isHex(data.color) ? data.color : 0xffffff,
    colorTop:
      data.colorTop === undefined
        ? null
        : data.colorTop === null || isHex(data.colorTop)
          ? data.colorTop
          : null,
    label: typeof data.label === "string" ? data.label : "",
    state: typeof data.state === "string" ? data.state : "",
    alpha:
      isFiniteNumber(data.alpha) && data.alpha >= 0 && data.alpha <= 1 ? data.alpha : 1,
    angle: isFiniteNumber(data.angle) ? data.angle : 0,
    length: isFiniteNumber(data.length) ? data.length : 0,
  };
}

/**
 * Strict SceneJSON parse: exact top-level keys, known prop kinds,
 * finite numbers, short strings, no unknown keys anywhere. Untrusted
 * model output can never smuggle gameplay or crash the painters.
 */
export function parseSceneJSON(data: unknown): SceneParse {
  if (!isRecord(data) || !exactKeys(data, TOP_KEYS)) {
    return fail("scene must hold the v1 top-level keys exactly");
  }
  if (data.version !== SCENE_SCHEMA_VERSION) {
    return fail("scene version must be 1");
  }
  if (data.game !== "city" && data.game !== "tote") {
    return fail('scene game must be "city" or "tote"');
  }
  const game: SceneGame = data.game === "tote" ? "tote" : "city";
  if (
    typeof data.seed !== "number" ||
    !Number.isInteger(data.seed) ||
    typeof data.turn !== "number" ||
    !Number.isInteger(data.turn) ||
    !isFiniteNumber(data.progress01) ||
    data.progress01 < 0 ||
    data.progress01 > 1 ||
    !isFiniteNumber(data.t)
  ) {
    return fail("scene seed/turn/progress01/t are malformed");
  }
  if (data.shock !== null && data.shock !== "flood" && data.shock !== "heat") {
    return fail("scene shock must be flood, heat, or null");
  }
  const ground = data.ground;
  // Halo arrived with dressing v2; older scenes omit it and read 0.
  const groundKeys =
    isRecord(ground) && "halo" in ground
      ? ["disc", "dots", "seed", "halo"]
      : ["disc", "dots", "seed"];
  if (
    !isRecord(ground) ||
    !exactKeys(ground, groundKeys) ||
    !isHex(ground.disc) ||
    !isHex(ground.dots) ||
    typeof ground.seed !== "number" ||
    !Number.isInteger(ground.seed) ||
    (groundKeys.length === 4 &&
      (!isFiniteNumber(ground.halo) || ground.halo < 0 || ground.halo > 1))
  ) {
    return fail("scene ground must hold disc, dots, seed, and optional halo");
  }
  const weather = data.weather;
  if (
    !isRecord(weather) ||
    !exactKeys(weather, ["kind", "amount", "shakeX", "shakeY"]) ||
    (weather.kind !== null &&
      weather.kind !== "rain" &&
      weather.kind !== "heat" &&
      weather.kind !== "seismic") ||
    !isFiniteNumber(weather.amount) ||
    !isFiniteNumber(weather.shakeX) ||
    !isFiniteNumber(weather.shakeY)
  ) {
    return fail("scene weather is malformed");
  }
  let rain: SceneJSON["rain"] = null;
  if (data.rain !== null) {
    if (!Array.isArray(data.rain) || data.rain.length > 400) {
      return fail("scene rain must be null or a drop list");
    }
    const drops: { x: number; y: number; z: number }[] = [];
    for (const drop of data.rain) {
      if (
        !isRecord(drop) ||
        !exactKeys(drop, ["x", "y", "z"]) ||
        !isFiniteNumber(drop.x) ||
        !isFiniteNumber(drop.y) ||
        !isFiniteNumber(drop.z)
      ) {
        return fail("scene rain drops must hold finite x, y, z");
      }
      drops.push({ x: drop.x, y: drop.y, z: drop.z });
    }
    rain = drops;
  }
  if (!Array.isArray(data.props) || data.props.length > 600) {
    return fail("scene props must be a list of at most 600");
  }
  const props: SceneProp[] = [];
  for (const prop of data.props) {
    const parsed = parseProp(prop);
    if (parsed === null) {
      return fail("scene holds a malformed prop");
    }
    props.push(parsed);
  }
  return {
    ok: true,
    value: {
      version: 1,
      game,
      seed: data.seed,
      turn: data.turn,
      shock: data.shock,
      progress01: data.progress01,
      t: data.t,
      ground: {
        disc: ground.disc,
        dots: ground.dots,
        seed: ground.seed,
        halo: groundKeys.length === 4 ? (ground.halo as number) : 0,
      },
      weather: {
        kind: weather.kind,
        amount: weather.amount,
        shakeX: weather.shakeX,
        shakeY: weather.shakeY,
      },
      rain,
      props,
    },
  };
}

export type PropSummary = Pick<SceneProp, "id" | "kind" | "x" | "z"> &
  Partial<Pick<SceneProp, "label" | "state">>;

/** Model-readable prop roster: ids, kinds, footprints, labels. */
export function listProps(scene: SceneJSON): PropSummary[] {
  return scene.props.map((prop) => ({
    id: prop.id,
    kind: prop.kind,
    x: prop.x,
    z: prop.z,
    label: prop.label,
    state: prop.state,
  }));
}

/**
 * Upsert one prop by id (immutable): validates the incoming prop
 * through the same strict parse as whole scenes, so model-placed
 * props can never corrupt a live frame.
 */
export function placeProp(scene: SceneJSON, prop: unknown): SceneJSON {
  const parsed = parseProp(prop);
  if (parsed === null) {
    return scene;
  }
  const next = scene.props.filter((p) => p.id !== parsed.id);
  next.push(parsed);
  return { ...scene, props: next };
}

export interface RenderTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

/**
 * The mini-MCP surface: one tool per verb, each with a JSON schema
 * an MCP-server transport can register verbatim. Handlers are the
 * exports above; render_scene executes client-side (it needs a 2D
 * context), the rest are pure and run anywhere.
 */
export const RENDER_TOOLS: RenderTool[] = [
  {
    name: "describe_city",
    description: "Build a city SceneJSON frame from a match result at clock time t.",
    inputSchema: {
      type: "object",
      required: ["result", "t"],
      properties: {
        result: { type: "object", description: "MatchResultPayload" },
        t: { type: "number", description: "Replay clock ms" },
        selectedTurn: { type: ["number", "null"] },
        reduced: { type: "boolean" },
      },
    },
  },
  {
    name: "describe_tote",
    description: "Build a tote pack-out SceneJSON frame at clock time t.",
    inputSchema: {
      type: "object",
      required: ["t"],
      properties: {
        catalog: { type: ["object", "null"] },
        result: { type: ["object", "null"] },
        t: { type: "number", description: "Pack clock ms" },
        reduced: { type: "boolean" },
      },
    },
  },
  {
    name: "render_scene",
    description: "Paint a SceneJSON frame onto a 2D canvas. Client-side only.",
    inputSchema: {
      type: "object",
      required: ["scene", "sizePx"],
      properties: {
        scene: { type: "object", description: "SceneJSON v1" },
        sizePx: { type: "number" },
      },
    },
  },
  {
    name: "place_prop",
    description: "Upsert one validated prop into a scene by id.",
    inputSchema: {
      type: "object",
      required: ["scene", "prop"],
      properties: {
        scene: { type: "object", description: "SceneJSON v1" },
        prop: { type: "object", description: "Partial SceneProp" },
      },
    },
  },
  {
    name: "list_props",
    description: "Summarize a scene's props for model callers.",
    inputSchema: {
      type: "object",
      required: ["scene"],
      properties: { scene: { type: "object", description: "SceneJSON v1" } },
    },
  },
  {
    name: "validate_scene",
    description: "Strict-parse scene JSON and report the first error.",
    inputSchema: {
      type: "object",
      required: ["scene"],
      properties: { scene: { description: "Unknown JSON value" } },
    },
  },
];

type PropInput = Pick<SceneProp, "id" | "kind" | "x" | "z"> &
  Partial<Omit<SceneProp, "id" | "kind" | "x" | "z">>;

function fillProp(input: PropInput): SceneProp {
  return {
    y: 0,
    size: 1,
    height: 1,
    color: 0xffffff,
    colorTop: null,
    label: "",
    state: "",
    alpha: 1,
    angle: 0,
    length: 0,
    ...input,
  };
}

const CACTUS_SKIN = 0x4a9e4d;
const TRUNK_HEX = 0x7a4a2c;
const CRANE_DARK = 0x2c2132;
const CRANE_NEON = 0x2fe8d8;
const TOTE_BIN = 0xb47aff;
const TOTE_RIM = 0x8a5cd6;
const CLOUD_HEX = 0xf4eef8;

export interface CityDescribeInput {
  result: MatchResultPayload;
  t: number;
  turnFloat: number;
  selectedTurn: number | null;
  reduced: boolean;
  assets: ChallengeAssets;
  heightScale: number;
  widthScale: number;
  companion: { scale: number; angle: number };
  totalMs: number;
}

/**
 * One frozen city frame: towers from played shares, turn discs,
 * crane choreography, hut, grove, terrain, clouds, companion,
 * dressing, shock water, restoration weather. Seeded draw orders
 * replay the old 3D exactly, so the same seed lays the same park.
 */
export function describeCityScene(input: CityDescribeInput): SceneJSON {
  const {
    result,
    t,
    turnFloat,
    selectedTurn,
    reduced,
    assets,
    heightScale,
    widthScale,
    companion,
    totalMs,
  } = input;
  const turnsCount = result.turns.length;
  const seed = result.seed;
  const frozen = selectedTurn !== null;
  const shock = shockKind(turnFloat, selectedTurn);
  const turn = selectedTurn ?? turnAt(t, turnsCount);
  const props: SceneProp[] = [];
  const push = (prop: PropInput): void => {
    props.push(fillProp(prop));
  };
  const shares = towerShares(result.turns, turnFloat, selectedTurn, turnsCount);
  // Eight floating labels collide in the iso ring; the three biggest
  // budget lines of the match carry the story. Ranked on match
  // totals (never the live frame), so labels never flicker mid-replay.
  const leaders = new Set(topKeysByTotal(result.turns, 3));
  shares.forEach((tower, index) => {
    const spot = towerPosition(index, shares.length);
    push({
      id: `tower:${tower.key}`,
      kind: "tower",
      x: spot.x,
      z: spot.z,
      height: Math.max(tower.height * heightScale, 0.05),
      size: widthScale,
      color: TOWER_COLORS[tower.key],
      label: leaders.has(tower.key)
        ? `${KEY_SHORT[tower.key] ?? tower.key} ${String(Math.round(tower.share))}%`
        : "",
    });
  });
  for (const disc of turnDiscs(turnsCount)) {
    const state =
      disc.turn === selectedTurn
        ? "selected"
        : disc.turn === turn
          ? "active"
          : disc.turn < turn
            ? "done"
            : "todo";
    push({
      id: `disc:${String(disc.turn)}`,
      kind: "disc",
      x: disc.x,
      z: disc.z,
      size: state === "selected" ? 1.3 : 1,
      color: PALETTE3D.brand,
      label: String(disc.turn),
      state,
    });
  }
  skyline(seed).forEach((box, index) => {
    push({
      id: `sky:${String(index)}`,
      kind: "skyline",
      x: box.x,
      z: box.z,
      size: box.w,
      height: box.h,
      color: box.far ? PALETTE3D.far : PALETTE3D.mid,
      state: box.far ? "far" : "near",
    });
  });
  const pose = cranePose(frozen ? 0 : t, reduced);
  const tipX = CRANE_X + Math.sin(pose.jibAngle) * (JIB_ARM - 0.15);
  const tipZ = CRANE_Z + Math.cos(pose.jibAngle) * (JIB_ARM - 0.15);
  push({
    id: "crane",
    kind: "crane",
    x: CRANE_X,
    z: CRANE_Z,
    height: JIB_HEIGHT,
    color: swatchHex(assets.palette.crane),
    angle: pose.jibAngle,
    length: pose.cableLength,
  });
  push({
    id: "hook",
    kind: "hook",
    x: tipX,
    y: JIB_HEIGHT - pose.cableLength,
    z: tipZ,
  });
  push({
    id: "tote",
    kind: "tote",
    x: pose.toteX,
    y: pose.toteY,
    z: pose.toteZ,
    state: pose.hooked ? "hooked" : "free",
  });
  const hut = hutSpot(seed);
  push({ id: "hut", kind: "hut", x: hut.x, z: hut.z, angle: hut.rotY });
  const mood = vegetationMood(result.turns);
  const leaf =
    shock === "heat"
      ? STAGE.VEGETATION.SCORCH_LEAF
      : lerpHex(STAGE.VEGETATION.DRY_LEAF, STAGE.VEGETATION.LUSH_LEAF, mood.lush01);
  const treeRand = mulberry32(seed * 31 + 7);
  for (let i = 0; i < assets.scenery.trees; i += 1) {
    const x = -10 + treeRand() * 20;
    const z = -3.4 - treeRand() * 2.4;
    const s = 0.8 + treeRand() * 0.7;
    if (i % 3 === 2) {
      push({ id: `pine:${String(i)}`, kind: "pine", x, z, size: s, color: leaf });
    } else {
      push({ id: `tree:${String(i)}`, kind: "tree", x, z, size: s, color: leaf });
    }
  }
  const aridCount = Math.round(mood.arid01 * STAGE.VEGETATION.ARID_CACTI);
  groveSpots(aridCount, seed, 77).forEach((spot, index) => {
    push({
      id: `cactus:grove:${String(index)}`,
      kind: "cactus",
      x: spot.x,
      z: spot.z,
      size: spot.s,
    });
  });
  for (const feature of terrainFeatures(result.environment)) {
    const base = `${feature.site}:${String(feature.index)}`;
    if (feature.kind === "rock") {
      push({
        id: `rock:${base}`,
        kind: "rock",
        x: feature.x,
        z: feature.z,
        size: feature.scale,
      });
    } else if (feature.kind === "vent") {
      push({
        id: `vent:${base}`,
        kind: "vent",
        x: feature.x,
        z: feature.z,
        size: feature.scale,
      });
      const phase = reduced || frozen ? 0.3 : (t / 1100 + (feature.index % 7) / 7) % 1;
      push({
        id: `puff:${base}`,
        kind: "puff",
        x: feature.x,
        z: feature.z,
        y: 0.55 + phase * 1.05,
        size: 0.55 + phase * 0.95,
        alpha: 0.5 * (1 - phase),
      });
    } else if (feature.scale >= cactusCutoff()) {
      push({
        id: `flora:${base}`,
        kind: "cactus",
        x: feature.x,
        z: feature.z,
        size: feature.scale,
      });
    } else {
      push({
        id: `flora:${base}`,
        kind: "tree",
        x: feature.x,
        z: feature.z,
        size: feature.scale,
        color: leaf,
      });
    }
  }
  const cloudRand = mulberry32(seed * 17 + 3);
  for (let i = 0; i < assets.scenery.clouds; i += 1) {
    const balls: { r: number; dx: number; dy: number }[] = [];
    for (let p = 0; p < 3; p += 1) {
      balls.push({
        r: 0.55 + cloudRand() * 0.4,
        dx: p * 0.75 - 0.75,
        dy: cloudRand() * 0.25,
      });
    }
    const baseX = -12 + cloudRand() * 24;
    const cy = 6.8 + cloudRand() * 2.2;
    const cz = -7 - cloudRand() * 3;
    const speed = 0.00035 + cloudRand() * 0.0004;
    const drifted = reduced ? baseX : ((((baseX + t * speed) % 30) + 30) % 30) - 15;
    balls.forEach((b, p) => {
      push({
        id: `cloud:${String(i)}:${String(p)}`,
        kind: "cloudpuff",
        x: drifted + b.dx,
        y: cy + b.dy,
        z: cz,
        size: b.r,
      });
    });
  }
  push({
    id: "companion",
    kind: "companion",
    x: COMPANION.x,
    y: COMPANION.y,
    z: COMPANION.z,
    size: companion.scale,
    color: swatchHex(assets.palette.moon),
    colorTop: swatchHex(assets.palette.crater),
    angle: companion.angle,
    length: assets.moon.craters,
  });
  const accent = swatchHex(assets.palette.accent);
  const dressing: [DressingKind, number][] = [
    ["beacon", assets.scenery.beacons],
    ["pennant", assets.scenery.pennants],
    ["shroom", assets.scenery.shrooms],
    ["lantern", assets.scenery.lanterns],
  ];
  for (const [kind, count] of dressing) {
    dressingSpots(kind, count, seed).forEach((spot, index) => {
      push({
        id: `${kind}:${String(index)}`,
        kind,
        x: spot.x,
        z: spot.z,
        size: spot.s,
        color: accent,
        angle: spot.spin,
      });
    });
  }
  if (shock === "flood") {
    push({
      id: "water",
      kind: "water",
      x: 0,
      z: 0.5,
      y: 0.22 + Math.sin(t / 450) * 0.03,
      size: 11.5,
      color: PALETTE3D.water,
      alpha: 0.55 + Math.sin(t / 300) * 0.08,
    });
  }
  const environment = result.environment;
  const weatherName = environment?.restoration.weather ?? null;
  const weatherKind: WeatherKind =
    weatherName === "rain" || weatherName === "heat" || weatherName === "seismic"
      ? weatherName
      : null;
  const rAmount =
    environment === undefined
      ? 0
      : restorationAmount(
          frozen ? turn - 0.5 : turnFloat,
          environment.restoration.turns,
        );
  let rain: SceneJSON["rain"] = null;
  if (weatherKind === "rain" && rAmount > 0) {
    const rainRand = mulberry32(seed * 53 + 29);
    const drops: { x: number; y: number; z: number }[] = [];
    for (let i = 0; i < 130; i += 1) {
      const x = -13 + rainRand() * 26;
      const z = -4 + rainRand() * 10;
      const base = rainRand() * 6.5;
      const fall = reduced ? base : (base + t * 0.006 + i * 0.37) % 6.5;
      drops.push({ x, y: 6.5 - fall, z });
    }
    rain = drops;
  }
  if (weatherKind === "heat" && rAmount > 0) {
    push({
      id: "veil",
      kind: "veil",
      x: 0,
      z: 0,
      color: PALETTE3D.heat,
      alpha: rAmount * 0.16,
    });
  }
  const shaking = weatherKind === "seismic" && rAmount > 0 && !reduced && !frozen;
  return {
    version: 1,
    game: "city",
    seed,
    turn,
    shock,
    progress01: totalMs > 0 ? clamp01(t / totalMs) : 0,
    t,
    ground: {
      disc: swatchHex(assets.palette.moon),
      dots: swatchHex(assets.palette.crater),
      seed,
      halo: assets.moon.halo,
    },
    weather: {
      kind: weatherKind,
      amount: rAmount,
      shakeX: shaking ? Math.sin(t / 45) * 0.06 * rAmount : 0,
      shakeY: shaking ? Math.sin(t / 61) * 0.03 * rAmount : 0,
    },
    rain,
    props,
  };
}

const TOTE_BASE_Y = 0.52;
const HOVER_Y = 3.1;

const CRATE_CSS = [
  "#8a5a35",
  "#7a6a2b",
  "#5d7a35",
  "#357a68",
  "#35507a",
  "#5d357a",
  "#7a355d",
  "#8a3535",
];

/** Stable crate paint from the item id (same hash the 3D used). */
export function crateColor(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i += 1) {
    hash = (hash * 31 + id.charCodeAt(i)) | 0;
  }
  return CRATE_CSS[Math.abs(hash) % CRATE_CSS.length] ?? CRATE_CSS[0] ?? "#8a5a35";
}

function easeOut(t: number): number {
  return 1 - (1 - t) * (1 - t);
}

/** Grid slot (2x2 per layer) inside a bin or on the pallet. */
function slotOffset(index: number): { x: number; y: number; z: number } {
  return {
    x: index % 2 === 0 ? -0.38 : 0.38,
    y: 0.43 + Math.floor(index / 4) * 0.43,
    z: Math.floor(index / 2) % 2 === 0 ? -0.25 : 0.25,
  };
}

function lerp(a: number, b: number, q: number): number {
  return a + (b - a) * q;
}

export interface ToteDescribeInput {
  catalog: ToteCatalog | null;
  result: TotePackResult | null;
  t: number;
  reduced: boolean;
  companion: { scale: number; angle: number };
  totalMs: number;
}

/**
 * One frozen tote frame: hovering trailer, slatted pallet, crates
 * arcing pallet-to-bin in packing order, crane tracking the flying
 * crate. Before a run the trailer just hovers by the crane.
 */
export function describeToteScene(input: ToteDescribeInput): SceneJSON {
  const { catalog, result, t, reduced, companion, totalMs } = input;
  const seed = result?.seed ?? 0;
  const items = new Map((catalog?.items ?? []).map((item) => [item.id, item]));
  const weights = new Map(
    [...items.entries()].map(([id, item]) => [id, item.weight] as const),
  );
  const pack = result !== null && result.invalid_reason === null ? result.packing : [];
  const home = toteHomePoint();
  const pallet = palletPoint();
  const bob = reduced ? 0 : Math.sin(t / 640) * 0.05;
  const props: SceneProp[] = [];
  const push = (prop: PropInput): void => {
    props.push(fillProp(prop));
  };
  push({
    id: "tote",
    kind: "tote",
    x: home.x,
    y: TOTE_BASE_Y + bob,
    z: home.z,
    state: "hover",
  });
  push({ id: "pallet", kind: "pallet", x: pallet.x, z: pallet.z });
  let hookTarget = {
    x: home.x,
    y: TOTE_BASE_Y + bob + 1.62,
    z: home.z,
  };
  let tracked = false;
  for (const crate of toteCrates(pack, weights, t)) {
    const slot = slotOffset(crate.index);
    const palletPos = {
      x: pallet.x + slot.x,
      y: 0.16 + slot.y,
      z: pallet.z + slot.z,
    };
    const slotPos = {
      x: home.x + slot.x,
      y: TOTE_BASE_Y + bob + slot.y,
      z: home.z + slot.z,
    };
    let x = palletPos.x;
    let y = palletPos.y;
    let z = palletPos.z;
    if (crate.progress > 0 && crate.progress < 0.5) {
      const q = easeOut(crate.progress / 0.5);
      x = lerp(palletPos.x, slotPos.x, q);
      z = lerp(palletPos.z, slotPos.z, q);
      y = lerp(palletPos.y, HOVER_Y, q) + Math.sin(q * Math.PI) * 0.7;
    } else if (crate.progress >= 0.5 && crate.progress < 1) {
      const q = easeOut((crate.progress - 0.5) / 0.5);
      x = slotPos.x;
      z = slotPos.z;
      y = lerp(HOVER_Y, slotPos.y, q);
    } else if (crate.progress >= 1) {
      x = slotPos.x;
      y = slotPos.y;
      z = slotPos.z;
    }
    const weight = items.get(crate.id)?.weight ?? 1;
    push({
      id: `crate:${crate.id}`,
      kind: "crate",
      x,
      y,
      z,
      size: crateSize(weight),
      color: cssToHex(crateColor(crate.id)),
      state: crate.landed ? "landed" : crate.progress > 0 ? "flying" : "parked",
    });
    if (crate.progress > 0 && crate.progress < 1) {
      hookTarget = { x, y: y + 0.34, z };
      tracked = true;
    }
  }
  const pose = cranePose(t, reduced);
  const jib = tracked
    ? Math.atan2(hookTarget.x - CRANE_X, hookTarget.z - CRANE_Z)
    : pose.jibAngle;
  const tipX = CRANE_X + Math.sin(jib) * (JIB_ARM - 0.15);
  const tipZ = CRANE_Z + Math.cos(jib) * (JIB_ARM - 0.15);
  push({
    id: "crane",
    kind: "crane",
    x: CRANE_X,
    z: CRANE_Z,
    height: JIB_HEIGHT,
    color: 0xffd23f,
    angle: jib,
    length: Math.hypot(
      tipX - hookTarget.x,
      JIB_HEIGHT - hookTarget.y,
      tipZ - hookTarget.z,
    ),
  });
  push({
    id: "hook",
    kind: "hook",
    x: hookTarget.x,
    y: hookTarget.y,
    z: hookTarget.z,
  });
  push({
    id: "companion",
    kind: "companion",
    x: COMPANION.x,
    y: COMPANION.y,
    z: COMPANION.z,
    size: companion.scale,
    color: PALETTE3D.moon,
    colorTop: PALETTE3D.crater,
    angle: companion.angle,
    length: 14,
  });
  return {
    version: 1,
    game: "tote",
    seed,
    turn: 1,
    shock: null,
    progress01: totalMs > 0 ? clamp01(t / totalMs) : 0,
    t,
    // Tote packs carry no custom dressing yet, so the halo stays off.
    ground: { disc: PALETTE3D.moon, dots: PALETTE3D.crater, seed, halo: 0 },
    weather: { kind: null, amount: 0, shakeX: 0, shakeY: 0 },
    rain: null,
    props,
  };
}

/**
 * Subject fits: the moon disc bleeds off-frame as ground. The far
 * skyline layer sits behind the fit and peeks from the top edge.
 */
export const CITY_FIT: IsoBounds = { minX: -12, maxX: 13, minZ: -9.5, maxZ: 7.5 };
// Headroom for a max-share tower (11.5) plus its label.
export const CITY_FIT_Y = 13;
export const TOTE_FIT: IsoBounds = { minX: -3, maxX: 12.5, minZ: -7, maxZ: 7 };
export const TOTE_FIT_Y = 5;
const FIT_MARGIN = 24;

/**
 * Headroom a scene needs: tallest non-sky prop plus label room.
 * Painters and disc picking share it, so the frame never drifts
 * between the two. Sky props (companion, clouds) bleed by design.
 */
export function sceneMaxY(scene: SceneJSON): number {
  const cap = scene.game === "city" ? CITY_FIT_Y : TOTE_FIT_Y;
  let need = 4;
  for (const prop of scene.props) {
    if (prop.kind === "companion" || prop.kind === "cloudpuff") {
      continue;
    }
    need = Math.max(need, prop.y + prop.height + 1.2);
  }
  return Math.min(need, cap);
}

/**
 * Nearest turn disc to a canvas point (css px), if inside the hit
 * radius. Pure so the component's pointer handler stays thin.
 */
export function pickDiscTurn(
  discs: { turn: number; x: number; z: number }[],
  cam: IsoCamera,
  view: IsoView,
  px: number,
  py: number,
  hitR: number,
): number | null {
  let best: number | null = null;
  let bestD = Infinity;
  for (const disc of discs) {
    const c = project(cam, disc.x, 0.05, disc.z, view);
    const d = Math.hypot(px - c.x, py - c.y);
    if (d < hitR && d < bestD) {
      best = disc.turn;
      bestD = d;
    }
  }
  return best;
}

/** The fitted frame for a scene: shared by painters and picking. */
export function sceneCamera(game: SceneGame, sizePx: number, maxY: number): IsoCamera {
  return fitCamera(sizePx, game === "city" ? CITY_FIT : TOTE_FIT, maxY, FIT_MARGIN);
}

export interface RenderOpts {
  view?: IsoView;
  cam?: IsoCamera;
}

function text(
  ctx: Ctx,
  s: string,
  x: number,
  y: number,
  px: number,
  fill = "#ffffff",
): void {
  ctx.font = `600 ${String(px)}px ${FONT}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.lineWidth = Math.max(2, px / 4);
  ctx.strokeStyle = "rgba(20,8,10,0.85)";
  ctx.strokeText(s, x, y);
  ctx.fillStyle = fill;
  ctx.fillText(s, x, y);
}

/**
 * The shared moon: ground disc plus seeded craters. Game stages
 * and the ranks board stand on the same one.
 */
export function paintMoonDisc(
  ctx: Ctx,
  cam: IsoCamera,
  view: IsoView,
  disc: number,
  dots: number,
  seed: number,
  halo = 0,
): void {
  if (halo > 0) {
    isoDisc(
      ctx,
      cam,
      { x: 0, z: 0, r: MOON_RADIUS * 1.16, fill: toCss(dots), alpha: halo * 0.22 },
      view,
    );
  }
  isoDisc(ctx, cam, { x: 0, z: 0, r: MOON_RADIUS, fill: toCss(disc) }, view);
  const rand = mulberry32(seed * 97 + 13);
  for (let i = 0; i < 11; i += 1) {
    const radius = 0.5 + rand() * 1.1;
    const dist = 3 + rand() * 11.5;
    const theta = rand() * Math.PI * 2;
    isoDisc(
      ctx,
      cam,
      {
        x: Math.cos(theta) * dist,
        z: Math.sin(theta) * dist,
        r: radius,
        y: 0.012,
        fill: toCss(dots),
      },
      view,
    );
  }
}

/**
 * Paint one frozen frame: clear sky (the site backdrop shows
 * through), ground, water, depth-sorted props, rain, washes. Pure
 * paint — every animated value is already baked into the scene.
 */
export function renderScene(
  ctx: Ctx,
  scene: SceneJSON,
  sizePx: number,
  opts: RenderOpts = {},
): void {
  const cam = opts.cam ?? sceneCamera(scene.game, sizePx, sceneMaxY(scene));
  const view = opts.view ?? ISO_VIEW_FLAT;
  ctx.clearRect(0, 0, sizePx, sizePx);
  ctx.save();
  if (scene.weather.shakeX !== 0 || scene.weather.shakeY !== 0) {
    ctx.translate(scene.weather.shakeX * cam.scale, scene.weather.shakeY * cam.scale);
  }
  paintMoonDisc(
    ctx,
    cam,
    view,
    scene.ground.disc,
    scene.ground.dots,
    scene.ground.seed,
    scene.ground.halo,
  );
  const hook = scene.props.find((p) => p.kind === "hook");
  const water = scene.props.filter((p) => p.kind === "water");
  const sorted = scene.props
    .filter((p) => p.kind !== "water" && p.kind !== "veil")
    .sort((a, b) => depthKey(a.x, a.z, view) - depthKey(b.x, b.z, view));
  for (const prop of water) {
    paintProp(ctx, cam, view, prop, hook);
  }
  for (const prop of sorted) {
    paintProp(ctx, cam, view, prop, hook);
  }
  if (scene.rain !== null && scene.weather.amount > 0) {
    ctx.save();
    ctx.globalAlpha = 0.65 * scene.weather.amount;
    ctx.strokeStyle = RAIN_CSS;
    ctx.lineWidth = Math.max(1, cam.scale * 0.06);
    ctx.beginPath();
    for (const drop of scene.rain) {
      const a = project(cam, drop.x, drop.y, drop.z, view);
      const b = project(cam, drop.x, drop.y - 0.35, drop.z, view);
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
    }
    ctx.stroke();
    ctx.restore();
  }
  for (const prop of scene.props.filter((p) => p.kind === "veil")) {
    ctx.save();
    ctx.globalAlpha = prop.alpha;
    ctx.fillStyle = toCss(prop.color);
    ctx.fillRect(0, 0, sizePx, sizePx);
    ctx.restore();
  }
  if (scene.shock === "heat") {
    ctx.save();
    ctx.globalAlpha = 0.14 + Math.sin(scene.t / 180) * 0.04;
    ctx.fillStyle = toCss(PALETTE3D.heat);
    ctx.fillRect(0, 0, sizePx, sizePx);
    ctx.restore();
  } else if (scene.shock === "flood") {
    ctx.save();
    ctx.globalAlpha = 0.1;
    ctx.fillStyle = toCss(PALETTE3D.water);
    ctx.fillRect(0, 0, sizePx, sizePx);
    ctx.restore();
  }
  ctx.restore();
}

const RAIN_CSS = "#9fd8ff";
const ROOF_HEX = 0x5a2c1a;
const WINDOW_CSS = "#ffd98a";
const PUPIL_CSS = "#1c0a0c";

function paintProp(
  ctx: Ctx,
  cam: IsoCamera,
  view: IsoView,
  prop: SceneProp,
  hook: SceneProp | undefined,
): void {
  switch (prop.kind) {
    case "tower":
      paintTower(ctx, cam, view, prop);
      break;
    case "disc":
      paintDisc(ctx, cam, view, prop);
      break;
    case "skyline":
      paintSkyline(ctx, cam, view, prop);
      break;
    case "crane":
      paintCrane(ctx, cam, view, prop, hook);
      break;
    case "hook":
      paintHook(ctx, cam, view, prop);
      break;
    case "tote":
      paintTote(ctx, cam, view, prop);
      break;
    case "hut":
      paintHut(ctx, cam, view, prop);
      break;
    case "tree":
      paintTree(ctx, cam, view, prop);
      break;
    case "pine":
      paintPine(ctx, cam, view, prop);
      break;
    case "cactus":
      paintCactus(ctx, cam, view, prop);
      break;
    case "rock":
      paintRock(ctx, cam, view, prop);
      break;
    case "vent":
      paintVent(ctx, cam, view, prop);
      break;
    case "puff":
    case "cloudpuff":
      paintPuff(ctx, cam, view, prop);
      break;
    case "companion":
      paintCompanion(ctx, cam, view, prop);
      break;
    case "beacon":
      paintBeacon(ctx, cam, view, prop);
      break;
    case "pennant":
      paintPennant(ctx, cam, view, prop);
      break;
    case "shroom":
      paintShroom(ctx, cam, view, prop);
      break;
    case "lantern":
      paintLantern(ctx, cam, view, prop);
      break;
    case "pallet":
      paintPallet(ctx, cam, view, prop);
      break;
    case "crate":
      paintCrate(ctx, cam, view, prop);
      break;
    case "water":
      paintWater(ctx, cam, view, prop);
      break;
    case "veil":
      break;
  }
}

function paintTower(ctx: Ctx, cam: IsoCamera, view: IsoView, prop: SceneProp): void {
  const w = 1.18 * prop.size;
  const h = prop.height;
  isoDisc(
    ctx,
    cam,
    { x: prop.x, z: prop.z, r: 1.15 * prop.size, y: 0.02, fill: "#000000", alpha: 0.3 },
    view,
  );
  isoBox(
    ctx,
    cam,
    {
      x: prop.x,
      z: prop.z,
      w,
      d: w,
      h,
      top: shade(prop.color, 1.25),
      left: shade(prop.color, 0.72),
      right: shade(prop.color, 0.55),
    },
    view,
  );
  // Lit windows up both faces.
  ctx.fillStyle = WINDOW_CSS;
  const rows = Math.max(1, Math.floor(h / 0.9));
  for (let r = 0; r < rows; r += 1) {
    const y = 0.7 + r * 0.9;
    if (y > h - 0.25) {
      break;
    }
    for (const c of [-0.28, 0.28]) {
      for (const face of [0, 1]) {
        const wx = face === 0 ? prop.x + c * w : prop.x + w / 2 + 0.01;
        const wz = face === 0 ? prop.z + w / 2 + 0.01 : prop.z + c * w;
        const p = project(cam, wx, y, wz, view);
        ctx.beginPath();
        ctx.arc(p.x, p.y, Math.max(1.2, cam.scale * 0.045), 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }
  // Pyramid roof cap.
  const apex = project(cam, prop.x, h + 0.62, prop.z, view);
  const hw = 0.72 * prop.size;
  const c10 = project(cam, prop.x + hw, h, prop.z - hw, view);
  const c01 = project(cam, prop.x - hw, h, prop.z + hw, view);
  const c11 = project(cam, prop.x + hw, h, prop.z + hw, view);
  poly(ctx, [apex, c10, c11], shade(ROOF_HEX, 0.75));
  poly(ctx, [apex, c01, c11], shade(ROOF_HEX, 0.9));
  // Goofy eyes on the +z face.
  const ey = Math.max(h - 0.32, 0.75);
  for (const side of [-0.29, 0.29]) {
    ball(ctx, cam, prop.x + side * w, ey, prop.z + w / 2 + 0.05, 0.15, "#ffffff", view);
    ball(ctx, cam, prop.x + side * w, ey, prop.z + w / 2 + 0.12, 0.07, PUPIL_CSS, view);
  }
  if (prop.label !== "") {
    const top = project(cam, prop.x, h + 1.1, prop.z, view);
    text(ctx, prop.label, top.x, top.y, Math.max(9, cam.scale * 0.85));
  }
}

function paintDisc(ctx: Ctx, cam: IsoCamera, view: IsoView, prop: SceneProp): void {
  const lit = prop.state === "active" || prop.state === "selected";
  isoDisc(
    ctx,
    cam,
    {
      x: prop.x,
      z: prop.z,
      r: 0.34 * prop.size,
      y: 0.05,
      fill: lit ? toCss(PALETTE3D.leader) : shade(prop.color, 0.45),
    },
    view,
  );
  if (prop.state === "selected") {
    const c = project(cam, prop.x, 0.05, prop.z, view);
    const { rx, ry } = isoDiscRadii(0.5 * prop.size, cam.scale, view);
    ctx.beginPath();
    ctx.ellipse(c.x, c.y, rx, ry, 0, 0, Math.PI * 2);
    ctx.strokeStyle = toCss(PALETTE3D.leader);
    ctx.lineWidth = 2;
    ctx.stroke();
  }
  if (prop.label !== "") {
    const c = project(cam, prop.x, 0.05, prop.z, view);
    text(
      ctx,
      prop.label,
      c.x,
      c.y,
      Math.max(8, cam.scale * 0.5),
      lit ? "#1c0a0c" : "#ffffff",
    );
  }
}

function paintSkyline(ctx: Ctx, cam: IsoCamera, view: IsoView, prop: SceneProp): void {
  isoBox(
    ctx,
    cam,
    {
      x: prop.x,
      z: prop.z,
      w: prop.size,
      d: 1.2,
      h: prop.height,
      top: shade(prop.color, 1.2),
      left: shade(prop.color, 0.8),
      right: shade(prop.color, 0.6),
    },
    view,
  );
  if (prop.state === "near") {
    ctx.fillStyle = WINDOW_CSS;
    for (let i = 0; i < 3; i += 1) {
      const p = project(
        cam,
        prop.x - prop.size / 4 + i * (prop.size / 4),
        prop.height * 0.6,
        prop.z + 0.61,
        view,
      );
      ctx.beginPath();
      ctx.arc(p.x, p.y, Math.max(1, cam.scale * 0.04), 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

function paintCrane(
  ctx: Ctx,
  cam: IsoCamera,
  view: IsoView,
  prop: SceneProp,
  hook: SceneProp | undefined,
): void {
  const paint = toCss(prop.color);
  isoBox(
    ctx,
    cam,
    {
      x: prop.x,
      z: prop.z,
      w: 1,
      d: 1,
      h: 0.45,
      top: shade(CRANE_DARK, 1.3),
      left: shade(CRANE_DARK, 0.8),
      right: shade(CRANE_DARK, 0.6),
    },
    view,
  );
  isoBox(
    ctx,
    cam,
    {
      x: prop.x,
      z: prop.z,
      w: 0.42,
      d: 0.42,
      h: prop.height,
      top: shade(prop.color, 1.25),
      left: shade(prop.color, 0.75),
      right: shade(prop.color, 0.55),
    },
    view,
  );
  isoBox(
    ctx,
    cam,
    {
      x: prop.x,
      z: prop.z + 0.45,
      w: 0.62,
      d: 0.62,
      h: 0.55,
      y0: prop.height - 0.62,
      top: shade(prop.color, 1.25),
      left: shade(prop.color, 0.75),
      right: shade(prop.color, 0.55),
    },
    view,
  );
  ball(ctx, cam, prop.x, prop.height - 0.28, prop.z + 0.79, 0.13, "#ffffff", view);
  ball(ctx, cam, prop.x, prop.height - 0.28, prop.z + 0.9, 0.06, PUPIL_CSS, view);
  // Jib arm toward the angle, neon strip under, counterweight behind.
  const mx = prop.x;
  const mz = prop.z;
  const my = prop.height;
  const tipX = mx + Math.sin(prop.angle) * JIB_ARM;
  const tipZ = mz + Math.cos(prop.angle) * JIB_ARM;
  const backX = mx - Math.sin(prop.angle) * 1.0;
  const backZ = mz - Math.cos(prop.angle) * 1.0;
  line(
    ctx,
    [project(cam, mx, my, mz, view), project(cam, tipX, my, tipZ, view)],
    paint,
    Math.max(2, cam.scale * 0.14),
  );
  line(
    ctx,
    [project(cam, mx, my - 0.12, mz, view), project(cam, tipX, my - 0.12, tipZ, view)],
    toCss(CRANE_NEON),
    Math.max(1, cam.scale * 0.05),
  );
  line(
    ctx,
    [project(cam, mx, my, mz, view), project(cam, backX, my, backZ, view)],
    paint,
    Math.max(2, cam.scale * 0.14),
  );
  isoBox(
    ctx,
    cam,
    {
      x: backX,
      z: backZ,
      w: 0.55,
      d: 0.4,
      h: 0.7,
      y0: my - 0.65,
      top: shade(CRANE_DARK, 1.3),
      left: shade(CRANE_DARK, 0.8),
      right: shade(CRANE_DARK, 0.6),
    },
    view,
  );
  // Cable from the jib tip to the hook.
  const jibTipX = mx + Math.sin(prop.angle) * (JIB_ARM - 0.15);
  const jibTipZ = mz + Math.cos(prop.angle) * (JIB_ARM - 0.15);
  const hx = hook?.x ?? jibTipX;
  const hy = hook?.y ?? my - prop.length;
  const hz = hook?.z ?? jibTipZ;
  line(
    ctx,
    [project(cam, jibTipX, my, jibTipZ, view), project(cam, hx, hy, hz, view)],
    shade(CRANE_DARK, 1.2),
    Math.max(1, cam.scale * 0.05),
  );
}

function paintHook(ctx: Ctx, cam: IsoCamera, view: IsoView, prop: SceneProp): void {
  isoBox(
    ctx,
    cam,
    {
      x: prop.x,
      z: prop.z,
      w: 0.22,
      d: 0.22,
      h: 0.18,
      y0: prop.y - 0.09,
      top: shade(CRANE_DARK, 1.3),
      left: shade(CRANE_DARK, 0.8),
      right: shade(CRANE_DARK, 0.6),
    },
    view,
  );
  ball(ctx, cam, prop.x, prop.y - 0.14, prop.z, 0.16, toCss(CRANE_NEON), view);
}

function paintTote(ctx: Ctx, cam: IsoCamera, view: IsoView, prop: SceneProp): void {
  const y = prop.y;
  isoDisc(
    ctx,
    cam,
    { x: prop.x, z: prop.z, r: 1.35, y: 0.02, fill: "#000000", alpha: 0.32 },
    view,
  );
  const dark = shade(CRANE_DARK, 1);
  isoBox(
    ctx,
    cam,
    {
      x: prop.x,
      z: prop.z,
      w: 1.9,
      d: 1.3,
      h: 0.16,
      y0: y - 0.08,
      top: shade(CRANE_DARK, 1.4),
      left: dark,
      right: shade(CRANE_DARK, 0.7),
    },
    view,
  );
  for (const corner of [
    { x: -0.75, z: -0.45 },
    { x: 0.75, z: -0.45 },
    { x: -0.75, z: 0.45 },
    { x: 0.75, z: 0.45 },
  ]) {
    ball(
      ctx,
      cam,
      prop.x + corner.x,
      y - 0.25,
      prop.z + corner.z,
      0.11,
      toCss(PALETTE3D.heat),
      view,
    );
  }
  isoBox(
    ctx,
    cam,
    {
      x: prop.x,
      z: prop.z,
      w: 1.6,
      d: 1.05,
      h: 0.14,
      y0: y + 0.08,
      top: shade(TOTE_BIN, 1.2),
      left: shade(TOTE_BIN, 0.75),
      right: shade(TOTE_BIN, 0.55),
    },
    view,
  );
  const walls = [
    { x: 0, z: -0.48, w: 1.6, d: 0.12, h: 0.95 },
    { x: 0, z: 0.48, w: 1.6, d: 0.12, h: 0.45 },
    { x: -0.76, z: 0, w: 0.12, d: 1.05, h: 0.95 },
    { x: 0.76, z: 0, w: 0.12, d: 1.05, h: 0.95 },
  ];
  for (const wall of walls) {
    isoBox(
      ctx,
      cam,
      {
        x: prop.x + wall.x,
        z: prop.z + wall.z,
        w: wall.w,
        d: wall.d,
        h: wall.h,
        y0: y + 0.22,
        top: shade(TOTE_BIN, 1.2),
        left: shade(TOTE_BIN, 0.75),
        right: shade(TOTE_BIN, 0.55),
      },
      view,
    );
  }
  // Rim lip.
  for (const rim of [
    { x: 0, z: -0.48, w: 1.72, d: 0.2 },
    { x: -0.76, z: 0, w: 0.2, d: 1.08 },
    { x: 0.76, z: 0, w: 0.2, d: 1.08 },
  ]) {
    isoBox(
      ctx,
      cam,
      {
        x: prop.x + rim.x,
        z: prop.z + rim.z,
        w: rim.w,
        d: rim.d,
        h: 0.09,
        y0: y + 1.165,
        top: shade(TOTE_RIM, 1.2),
        left: shade(TOTE_RIM, 0.8),
        right: shade(TOTE_RIM, 0.6),
      },
      view,
    );
  }
  // Hazard stripes on the low front wall.
  for (let i = 0; i < 5; i += 1) {
    const x0 = prop.x - 0.5 + i * 0.25;
    line(
      ctx,
      [
        project(cam, x0, y + 0.35, prop.z + 0.55, view),
        project(cam, x0 + 0.14, y + 0.55, prop.z + 0.55, view),
      ],
      i % 2 === 0 ? "#ffd23f" : "#1c0a0c",
      Math.max(1, cam.scale * 0.05),
    );
  }
  // Handle arc + eyes.
  const hc = project(cam, prop.x, y + 1.2, prop.z, view);
  ctx.beginPath();
  ctx.arc(hc.x, hc.y, Math.max(2, 0.34 * cam.scale), Math.PI, 0);
  ctx.strokeStyle = dark;
  ctx.lineWidth = Math.max(2, cam.scale * 0.07);
  ctx.stroke();
  for (const side of [-0.26, 0.26]) {
    ball(ctx, cam, prop.x + side, y + 0.5, prop.z + 0.56, 0.11, "#ffffff", view);
    ball(ctx, cam, prop.x + side, y + 0.5, prop.z + 0.63, 0.05, PUPIL_CSS, view);
  }
  if (prop.state === "hooked") {
    const c = project(cam, prop.x, y + 1.7, prop.z, view);
    text(
      ctx,
      "HOOKED",
      c.x,
      c.y,
      Math.max(8, cam.scale * 0.5),
      toCss(PALETTE3D.leader),
    );
  }
}

const HUT_WOOD = 0x6b4a2f;
const HUT_ROOF = 0x3d2b3d;

function paintHut(ctx: Ctx, cam: IsoCamera, view: IsoView, prop: SceneProp): void {
  // The door faces +z in the rest frame; the baked facing angle is
  // for model callers (and a future rotated-door painter).
  isoDisc(
    ctx,
    cam,
    { x: prop.x, z: prop.z, r: 0.95, y: 0.02, fill: "#000000", alpha: 0.3 },
    view,
  );
  isoBox(
    ctx,
    cam,
    {
      x: prop.x,
      z: prop.z,
      w: 1.1,
      d: 1.0,
      h: 1.5,
      top: shade(HUT_WOOD, 1.2),
      left: shade(HUT_WOOD, 0.75),
      right: shade(HUT_WOOD, 0.55),
    },
    view,
  );
  // Pitched roof: two slopes meeting at the ridge.
  const rx = 0.67;
  const eaveL = project(cam, prop.x - rx, 1.5, prop.z + 0.63, view);
  const eaveR = project(cam, prop.x + rx, 1.5, prop.z + 0.63, view);
  const ridgeL = project(cam, prop.x - rx, 1.9, prop.z, view);
  const ridgeR = project(cam, prop.x + rx, 1.9, prop.z, view);
  const eaveBL = project(cam, prop.x - rx, 1.5, prop.z - 0.63, view);
  const eaveBR = project(cam, prop.x + rx, 1.5, prop.z - 0.63, view);
  poly(ctx, [eaveL, eaveR, ridgeR, ridgeL], shade(HUT_ROOF, 0.9));
  poly(ctx, [ridgeL, ridgeR, eaveBR, eaveBL], shade(HUT_ROOF, 0.65));
  line(ctx, [ridgeL, ridgeR], shade(HUT_ROOF, 1.3), Math.max(2, cam.scale * 0.08));
  // Door on the +z face with its crescent cutout, knob, step, finial.
  const door = [
    project(cam, prop.x - 0.31, 0.1, prop.z + 0.51, view),
    project(cam, prop.x + 0.31, 0.1, prop.z + 0.51, view),
    project(cam, prop.x + 0.31, 1.15, prop.z + 0.51, view),
    project(cam, prop.x - 0.31, 1.15, prop.z + 0.51, view),
  ];
  poly(ctx, door, shade(HUT_WOOD, 0.6));
  ball(ctx, cam, prop.x, 0.85, prop.z + 0.53, 0.1, "#1c0a0c", view);
  ball(ctx, cam, prop.x + 0.24, 0.55, prop.z + 0.53, 0.035, "#2c1a0e", view);
  isoBox(
    ctx,
    cam,
    {
      x: prop.x,
      z: prop.z + 0.68,
      w: 0.7,
      d: 0.3,
      h: 0.12,
      top: "#9a938f",
      left: "#7a747f",
      right: "#5f5a66",
    },
    view,
  );
  ball(ctx, cam, prop.x, 2.02, prop.z, 0.12, toCss(PALETTE3D.leader), view);
}

function paintTree(ctx: Ctx, cam: IsoCamera, view: IsoView, prop: SceneProp): void {
  const s = prop.size;
  isoDisc(
    ctx,
    cam,
    { x: prop.x, z: prop.z, r: 0.7 * s, y: 0.02, fill: "#000000", alpha: 0.3 },
    view,
  );
  vline(
    ctx,
    cam,
    prop.x,
    prop.z,
    0,
    0.8 * s,
    toCss(TRUNK_HEX),
    Math.max(1.5, cam.scale * 0.11 * s),
    view,
  );
  ball(ctx, cam, prop.x, 1.25 * s, prop.z, 0.62 * s, toCss(prop.color), view);
  ball(
    ctx,
    cam,
    prop.x - 0.2 * s,
    1.05 * s,
    prop.z + 0.2 * s,
    0.2 * s,
    shade(prop.color, 0.7),
    view,
  );
}

function paintPine(ctx: Ctx, cam: IsoCamera, view: IsoView, prop: SceneProp): void {
  const s = prop.size;
  isoDisc(
    ctx,
    cam,
    { x: prop.x, z: prop.z, r: 0.55 * s, y: 0.02, fill: "#000000", alpha: 0.3 },
    view,
  );
  vline(
    ctx,
    cam,
    prop.x,
    prop.z,
    0,
    0.7 * s,
    toCss(TRUNK_HEX),
    Math.max(1.5, cam.scale * 0.1 * s),
    view,
  );
  const tiers: [number, number, number][] = [
    [0.62, 0.85, 0.85],
    [0.46, 0.75, 1.3],
    [0.3, 0.65, 1.7],
    [0.12, 0.5, 2.1],
  ];
  tiers.forEach(([r, h, y], i) => {
    const yb = (y - h / 2) * s;
    poly(
      ctx,
      [
        project(cam, prop.x - r * s, yb, prop.z, view),
        project(cam, prop.x + r * s, yb, prop.z, view),
        project(cam, prop.x, yb + h * s, prop.z, view),
      ],
      shade(prop.color, i % 2 === 0 ? 1 : 0.85),
    );
  });
}

function paintCactus(ctx: Ctx, cam: IsoCamera, view: IsoView, prop: SceneProp): void {
  const s = prop.size;
  const skin = toCss(CACTUS_SKIN);
  isoDisc(
    ctx,
    cam,
    { x: prop.x, z: prop.z, r: 0.5 * s, y: 0.02, fill: "#000000", alpha: 0.3 },
    view,
  );
  isoBox(
    ctx,
    cam,
    {
      x: prop.x,
      z: prop.z,
      w: 0.3 * s,
      d: 0.3 * s,
      h: 1.2 * s,
      top: shade(CACTUS_SKIN, 1.2),
      left: shade(CACTUS_SKIN, 0.8),
      right: shade(CACTUS_SKIN, 0.6),
    },
    view,
  );
  ball(ctx, cam, prop.x, 1.2 * s, prop.z, 0.14 * s, skin, view);
  for (const side of [-1, 1]) {
    const ex = prop.x + side * 0.3 * s;
    const ey = (0.62 + (side > 0 ? 0.14 : 0)) * s;
    isoBox(
      ctx,
      cam,
      {
        x: ex,
        z: prop.z,
        w: 0.16 * s,
        d: 0.16 * s,
        h: 0.42 * s,
        y0: ey,
        top: shade(CACTUS_SKIN, 1.2),
        left: skin,
        right: shade(CACTUS_SKIN, 0.7),
      },
      view,
    );
    ball(ctx, cam, ex, ey + 0.42 * s, prop.z, 0.09 * s, skin, view);
  }
  ball(ctx, cam, prop.x, 1.32 * s, prop.z, 0.09 * s, toCss(PALETTE3D.coral), view);
  // Pup at the foot.
  isoBox(
    ctx,
    cam,
    {
      x: prop.x + 0.29 * s,
      z: prop.z + 0.1 * s,
      w: 0.14 * s,
      d: 0.14 * s,
      h: 0.34 * s,
      top: shade(CACTUS_SKIN, 1.2),
      left: skin,
      right: shade(CACTUS_SKIN, 0.7),
    },
    view,
  );
}

function paintRock(ctx: Ctx, cam: IsoCamera, view: IsoView, prop: SceneProp): void {
  const r = 0.3 * prop.size;
  const pts = [];
  for (let i = 0; i < 6; i += 1) {
    const a = (i / 6) * Math.PI * 2 + 0.3;
    pts.push(
      project(
        cam,
        prop.x + Math.cos(a) * r,
        0.22 * prop.size,
        prop.z + Math.sin(a) * r * 0.7,
        view,
      ),
    );
  }
  poly(ctx, pts, "#8a7f8e");
  ball(ctx, cam, prop.x, 0.3 * prop.size, prop.z, 0.12 * prop.size, "#9a938f", view);
}

function paintVent(ctx: Ctx, cam: IsoCamera, view: IsoView, prop: SceneProp): void {
  const s = prop.size;
  poly(
    ctx,
    [
      project(cam, prop.x - 0.26 * s, 0, prop.z, view),
      project(cam, prop.x + 0.26 * s, 0, prop.z, view),
      project(cam, prop.x + 0.13 * s, 0.55 * s, prop.z, view),
      project(cam, prop.x - 0.13 * s, 0.55 * s, prop.z, view),
    ],
    "#3a2c3a",
  );
  ball(ctx, cam, prop.x, 0.55 * s, prop.z, 0.08 * s, toCss(PALETTE3D.heat), view);
}

function paintPuff(ctx: Ctx, cam: IsoCamera, view: IsoView, prop: SceneProp): void {
  const r = prop.kind === "puff" ? 0.16 * prop.size : prop.size;
  ctx.save();
  ctx.globalAlpha = prop.kind === "puff" ? prop.alpha : 0.95;
  ball(ctx, cam, prop.x, prop.y, prop.z, r, toCss(CLOUD_HEX), view);
  ctx.restore();
}

function paintCompanion(
  ctx: Ctx,
  cam: IsoCamera,
  view: IsoView,
  prop: SceneProp,
): void {
  const r = COMPANION.radius * prop.size;
  ball(ctx, cam, prop.x, prop.y, prop.z, r, toCss(prop.color), view);
  const rand = mulberry32(991);
  const count = Math.max(0, Math.round(prop.length));
  const cosA = Math.cos(prop.angle);
  const sinA = Math.sin(prop.angle);
  for (let i = 0; i < count; i += 1) {
    const size = (0.4 + rand() * 0.9) * prop.size;
    const theta = rand() * Math.PI * 2;
    const phi = Math.acos(2 * rand() - 1);
    const nx = Math.sin(phi) * Math.cos(theta);
    const nz = Math.sin(phi) * Math.sin(theta);
    const rx = nx * cosA + nz * sinA;
    const rz = -nx * sinA + nz * cosA;
    if (rx + rz <= 0) {
      continue;
    }
    ball(
      ctx,
      cam,
      prop.x + rx * r,
      prop.y + Math.cos(phi) * r,
      prop.z + rz * r,
      size,
      toCss(prop.colorTop ?? prop.color),
      view,
    );
  }
}

function paintBeacon(ctx: Ctx, cam: IsoCamera, view: IsoView, prop: SceneProp): void {
  const s = prop.size;
  vline(
    ctx,
    cam,
    prop.x,
    prop.z,
    0,
    1.6 * s,
    "#2c2132",
    Math.max(2, cam.scale * 0.08 * s),
    view,
  );
  ctx.save();
  ctx.globalAlpha = 0.3;
  ball(ctx, cam, prop.x, 1.7 * s, prop.z, 0.34 * s, toCss(prop.color), view);
  ctx.restore();
  ball(ctx, cam, prop.x, 1.7 * s, prop.z, 0.16 * s, toCss(prop.color), view);
}

function paintPennant(ctx: Ctx, cam: IsoCamera, view: IsoView, prop: SceneProp): void {
  const s = prop.size;
  const top = 1.8 * s;
  vline(
    ctx,
    cam,
    prop.x,
    prop.z,
    0,
    top,
    "#2c2132",
    Math.max(1.5, cam.scale * 0.06 * s),
    view,
  );
  const dx = Math.cos(prop.angle) * 0.62 * s;
  const dz = Math.sin(prop.angle) * 0.62 * s;
  poly(
    ctx,
    [
      project(cam, prop.x, top, prop.z, view),
      project(cam, prop.x + dx, top - 0.18 * s, prop.z + dz, view),
      project(cam, prop.x, top - 0.4 * s, prop.z, view),
    ],
    toCss(prop.color),
  );
}

function paintShroom(ctx: Ctx, cam: IsoCamera, view: IsoView, prop: SceneProp): void {
  const s = prop.size;
  vline(
    ctx,
    cam,
    prop.x,
    prop.z,
    0,
    0.4 * s,
    "#ffffff",
    Math.max(2, cam.scale * 0.12 * s),
    view,
  );
  ball(ctx, cam, prop.x, 0.45 * s, prop.z, 0.34 * s, toCss(prop.color), view);
  ball(
    ctx,
    cam,
    prop.x - 0.12 * s,
    0.58 * s,
    prop.z + 0.1 * s,
    0.06 * s,
    "#ffffff",
    view,
  );
  ball(
    ctx,
    cam,
    prop.x + 0.14 * s,
    0.5 * s,
    prop.z + 0.08 * s,
    0.045 * s,
    "#ffffff",
    view,
  );
}

/** Festival lantern: a short post with a glowing orb lamp. */
function paintLantern(ctx: Ctx, cam: IsoCamera, view: IsoView, prop: SceneProp): void {
  const s = prop.size;
  vline(
    ctx,
    cam,
    prop.x,
    prop.z,
    0,
    1.1 * s,
    "#2c2132",
    Math.max(2, cam.scale * 0.07 * s),
    view,
  );
  ctx.save();
  ctx.globalAlpha = 0.25;
  ball(ctx, cam, prop.x, 1.25 * s, prop.z, 0.4 * s, toCss(prop.color), view);
  ctx.restore();
  ball(ctx, cam, prop.x, 1.25 * s, prop.z, 0.18 * s, toCss(prop.color), view);
  ball(ctx, cam, prop.x, 1.25 * s, prop.z, 0.07 * s, "#ffffff", view);
}

function paintPallet(ctx: Ctx, cam: IsoCamera, view: IsoView, prop: SceneProp): void {
  const mat = { top: "#6b543a", left: "#54402c", right: "#40301f" };
  for (const sx of [-0.5, 0, 0.5]) {
    isoBox(
      ctx,
      cam,
      { x: prop.x + sx, z: prop.z, w: 0.34, d: 1.3, h: 0.07, y0: 0.165, ...mat },
      view,
    );
  }
  for (const sz of [-0.45, 0.45]) {
    isoBox(
      ctx,
      cam,
      { x: prop.x, z: prop.z + sz, w: 1.5, d: 0.24, h: 0.12, y0: 0, ...mat },
      view,
    );
  }
}

function paintCrate(ctx: Ctx, cam: IsoCamera, view: IsoView, prop: SceneProp): void {
  const w = 0.34 + prop.size * 0.3;
  isoBox(
    ctx,
    cam,
    {
      x: prop.x,
      z: prop.z,
      w,
      d: w,
      h: 0.42,
      y0: prop.y - 0.21,
      top: shade(prop.color, 1.2),
      left: shade(prop.color, 0.75),
      right: shade(prop.color, 0.55),
    },
    view,
  );
  // Edge lines, like the old EdgesGeometry.
  const x0 = prop.x - w / 2;
  const x1 = prop.x + w / 2;
  const z0 = prop.z - w / 2;
  const z1 = prop.z + w / 2;
  const y0 = prop.y - 0.21;
  const y1 = prop.y + 0.21;
  ctx.save();
  ctx.globalAlpha = 0.45;
  line(
    ctx,
    [
      project(cam, x0, y1, z0, view),
      project(cam, x1, y1, z0, view),
      project(cam, x1, y1, z1, view),
      project(cam, x0, y1, z1, view),
      project(cam, x0, y1, z0, view),
    ],
    "#1c0a0c",
    1,
  );
  line(
    ctx,
    [project(cam, x1, y0, z1, view), project(cam, x1, y1, z1, view)],
    "#1c0a0c",
    1,
  );
  line(
    ctx,
    [project(cam, x0, y0, z1, view), project(cam, x0, y1, z1, view)],
    "#1c0a0c",
    1,
  );
  ctx.restore();
}

function paintWater(ctx: Ctx, cam: IsoCamera, view: IsoView, prop: SceneProp): void {
  isoDisc(
    ctx,
    cam,
    {
      x: prop.x,
      z: prop.z,
      r: prop.size,
      y: prop.y,
      fill: toCss(prop.color),
      alpha: prop.alpha,
    },
    view,
  );
}
