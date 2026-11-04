/**
 * Website backdrop math: one giant planet fills a full 360°
 * ellipse behind the app, in the UI tokens from app/styles/base.css — no
 * new palette, no shipped image. Points live in planet-polar
 * coordinates so the same field rotates with the planet; the
 * component maps them to the screen each frame.
 */
import type { Application } from "pixi.js";
import { mulberry32 } from "./city-scene";

export const BACKDROP_SEED = 20261029;

/** Token hexes, brightest at the rim to the void at depth. */
export const BACKDROP_STOPS = ["#a33030", "#7a2323", "#4a1515", "#2b0e0e"] as const;

export const BACKDROP_VOID = "#0d0404";
export const BACKDROP_RIM = "#8fa3c7";
export const BACKDROP_STAR = "#ffffff";

/**
 * The planet as viewport fractions: horizontal center plus radius
 * of the shorter side, plus radians per millisecond of field
 * rotation. The vertical center is derived: the top limb rides 1px
 * under the viewport top, so every UI below displays on the planet
 * and no text crosses its boundary.
 */
export const PLANET = {
  // One center axis: the two-panel layout gives the moon rail the
  // left 10% and the planet panel the right 90%, so the panel, the
  // planet, and the centered writeup column all meet at 10% + 90%/2.
  cx: 0.55,
  r: 0.9,
  // One full turn a minute: slow enough to sit still, fast enough
  // to read as motion (the old two-minute turn looked frozen).
  spin: (Math.PI * 2) / 60000,
} as const;

export const PLANET_BOB_PX = 5;

/**
 * Top edge spacing: the planet's top limb rides exactly 1px under
 * the viewport top at every size — no header gap, no clamp band.
 */
export const PLANET_LIMB_TOP_PX = 1;

/**
 * Coverage slack over the exact-fit radius: the bob travel
 * (PLANET_BOB_PX) plus one rounding pixel. Keep both in step —
 * the coverage test fails if the slack drops below the bob.
 */
export const PLANET_COVER_SLACK_PX = 6;

/**
 * Planet radius in pixels for a viewport. The disc always covers
 * the full height below the top limb, plus the bob travel and a
 * rounding pixel, so the bottom stays covered at the top of the
 * bob instead of flashing a void strip.
 */
export function planetRadius(width: number, height: number): number {
  return (
    Math.max(PLANET.r * Math.min(width, height), (height - PLANET_LIMB_TOP_PX) / 2) +
    PLANET_COVER_SLACK_PX
  );
}

/** Planet center y in pixels for a viewport. */
export function planetCenterY(width: number, height: number): number {
  return PLANET_LIMB_TOP_PX + planetRadius(width, height);
}

/** How far the UI sphere panel sits inside the planet rim. */
export const PLANET_PANEL_INSET_PX = 48;

export interface PlanetPanel {
  x: number;
  y: number;
  r: number;
}

/**
 * UI sphere panel: concentric with the planet, inset from the rim.
 * Text lives inside it, clear of the boundary white line.
 */
export function planetPanel(width: number, height: number): PlanetPanel {
  return {
    x: PLANET.cx * width,
    y: planetCenterY(width, height),
    r: planetRadius(width, height) - PLANET_PANEL_INSET_PX,
  };
}

/**
 * Half-width of a disc chord at a viewport y: how far the disc
 * reaches left and right of its center there, or 0 past its edge.
 */
export function discHalfChord(centerY: number, radius: number, y: number): number {
  const dy = Math.abs(y - centerY);
  if (dy >= radius) {
    return 0;
  }
  return Math.sqrt(radius * radius - dy * dy);
}

/**
 * Writeup measure: the panel chord at the viewport's middle,
 * capped at the viewport width (the disc can span wider than the
 * screen on tall viewports). Text wider than this would cross the
 * boundary white line; the veil voids stragglers at other heights.
 */
export function panelMeasureWidth(width: number, height: number): number {
  const panel = planetPanel(width, height);
  const chord = 2 * discHalfChord(panel.y, panel.r, height / 2);
  return Math.min(chord, width);
}

/**
 * Right inset keeping the lane-scroll inside the planet: the lane's
 * outer edge stops a rim pad short of the disc's narrowest chord
 * across its span, or stays at the viewport edge when the disc
 * covers it there.
 */
export function lanePlanetInset(
  width: number,
  height: number,
  laneTop: number,
  laneHeight: number,
  rimPad: number,
): number {
  const radius = planetRadius(width, height);
  const centerY = planetCenterY(width, height);
  const centerX = PLANET.cx * width;
  const half = Math.min(
    discHalfChord(centerY, radius, laneTop),
    discHalfChord(centerY, radius, laneTop + laneHeight),
  );
  if (half <= 0) {
    return 0;
  }
  return Math.max(0, width - (centerX + half - rimPad));
}

/** Soft edge reach of the moon void bubble, past the hole radius. */
export const MOON_BUBBLE_FEATHER_PX = 12;

export interface MoonHole {
  x: number;
  y: number;
  r: number;
}

/**
 * Void bubble around the moon figure: the figure's center, half
 * its min side plus the lane gap.
 */
export function moonHole(
  rect: { x: number; y: number; width: number; height: number },
  lane: number,
): MoonHole {
  return {
    x: rect.x + rect.width / 2,
    y: rect.y + rect.height / 2,
    r: Math.min(rect.width, rect.height) / 2 + lane,
  };
}

/**
 * Suspend a backdrop app for unmount WITHOUT destroying its
 * renderer: Pixi's destroy() unconditionally loses the canvas GL
 * context, and remounts reuse the same canvas nodes (StrictMode
 * doubles every mount in dev) — a destroyed context poisons every
 * later mount white. The ticker stops and the scene frees its GPU
 * objects; the context stays alive for the next mount.
 */
export function suspendApp(app: Application): void {
  app.ticker.stop();
  app.stage.destroy({ children: true });
}

/**
 * Limb fade: 0 at the planet's rim, 1 once an object is inside the
 * inner 85% of the radius. Stipple and shapes multiply their alpha
 * by this so they blur in from the edge instead of popping.
 */
export function limbFade(radial: number): number {
  const FADE_BAND = 0.15;
  if (radial >= 1) {
    return 0;
  }
  if (radial <= 1 - FADE_BAND) {
    return 1;
  }
  const t = (radial - (1 - FADE_BAND)) / FADE_BAND;
  return 1 - t * t * (3 - 2 * t);
}

export interface BackdropDot {
  x: number;
  y: number;
  r: number;
  color: string;
  alpha: number;
  /** Twinkle phase in radians. */
  phase: number;
}

/** Stipple in planet-polar form: angle plus radius fraction 0..1. */
export interface PlanetDot {
  angle: number;
  radial: number;
  r: number;
  color: string;
  alpha: number;
}

export interface PlanetPoint {
  x: number;
  y: number;
}

/**
 * Map planet-polar coordinates to the screen with the planet
 * rotated by `spin` radians and bobbed by `bob` pixels.
 */
export function planetToScreen(
  angle: number,
  radial: number,
  spin: number,
  width: number,
  height: number,
  bob: number,
): PlanetPoint {
  const turned = angle + spin;
  const radius = planetRadius(width, height) * radial;
  return {
    x: PLANET.cx * width + radius * Math.cos(turned),
    y: planetCenterY(width, height) + bob + radius * Math.sin(turned),
  };
}

/**
 * 1 at the center, 0 on the rim, negative outside. The circle is
 * rotation-invariant, so depth needs no spin argument. The bob
 * shifts the center the same way the renderer bobs the planet.
 */
export function planetDepth(
  x: number,
  y: number,
  width: number,
  height: number,
  bob: number,
): number {
  const dx = x - PLANET.cx * width;
  const dy = y - (planetCenterY(width, height) + bob);
  return 1 - Math.hypot(dx, dy) / planetRadius(width, height);
}

/** Sparse star speckle in the void outside the planet. */
export function starField(
  seed: number,
  count: number,
  width: number,
  height: number,
): BackdropDot[] {
  const rand = mulberry32(seed);
  const stars: BackdropDot[] = [];
  let guard = 0;
  while (stars.length < count && guard < count * 30) {
    guard += 1;
    const x = rand() * width;
    const y = rand() * height;
    if (planetDepth(x, y, width, height, 0) > -0.02) {
      continue;
    }
    stars.push({
      x,
      y,
      r: 0.5 + rand() * 0.9,
      color: BACKDROP_STAR,
      alpha: 0.18 + rand() * 0.5,
      phase: rand() * Math.PI * 2,
    });
  }
  return stars;
}

/** How many leading stars glow and drift; one crossing takes 45s. */
export const GLOW_STAR_COUNT = 7;
const GLOW_CROSSING_MS = 45000;

/** The glow stars are the deterministic head of the star field. */
export function isGlowStar(index: number): boolean {
  return index >= 0 && index < GLOW_STAR_COUNT;
}

/** Glow-star x: drifts right-to-left with wraparound; frozen when reduced. */
export function glowStarX(
  x: number,
  timeMs: number,
  width: number,
  reduced: boolean,
): number {
  if (reduced || width <= 0) {
    return x;
  }
  const travelled = (timeMs / GLOW_CROSSING_MS) * width;
  return (((x - travelled) % width) + width) % width;
}

/**
 * Dithered stipple inside the planet. Acceptance falls toward the
 * center, so the field is dense and brand-bright at the rim and
 * dissolves inward.
 */
export function stippleField(seed: number, attempts: number): PlanetDot[] {
  const rand = mulberry32(seed * 7919 + 101);
  const dots: PlanetDot[] = [];
  for (let i = 0; i < attempts; i += 1) {
    const angle = rand() * Math.PI * 2;
    const radial = Math.sqrt(rand());
    const depth = 1 - radial;
    if (rand() > 0.22 + 0.78 * Math.pow(1 - depth, 1.2)) {
      continue;
    }
    const color =
      depth < 0.15
        ? BACKDROP_STOPS[0]
        : depth < 0.4
          ? BACKDROP_STOPS[1]
          : depth < 0.7
            ? BACKDROP_STOPS[2]
            : BACKDROP_STOPS[3];
    dots.push({
      angle,
      radial,
      r: 0.7 + rand() * 1.3,
      color,
      alpha: 0.82 - depth * 0.47,
    });
  }
  return dots;
}

export type PlanetShapeKind = "ring" | "triangle" | "cross" | "diamond" | "crater";

export interface PlanetShape {
  kind: PlanetShapeKind;
  /** Base angle in radians; depth 0 at the rim to 1 at the center. */
  angle: number;
  depth: number;
  size: number;
  phase: number;
}

const PLANET_KINDS: readonly PlanetShapeKind[] = [
  "ring",
  "triangle",
  "cross",
  "diamond",
  "crater",
];

/** Breathing room below the panel apex for stacked titles. */
export const PANEL_TOP_GAP_PX = 8;

/**
 * Stacked-tab rail padding: holds the title below the panel apex
 * so it never touches the rim point; zero when the rail already
 * starts below it. Layout-only — callers must not recompute it on
 * scroll, or the padding would pin content to the viewport.
 */
export function panelPadTop(
  viewportWidth: number,
  viewportHeight: number,
  railTopDoc: number,
): number {
  const panel = planetPanel(viewportWidth, viewportHeight);
  return Math.max(0, Math.ceil(panel.y - panel.r - railTopDoc + PANEL_TOP_GAP_PX));
}

/**
 * Faint shapes living inside the planet field: outline rings,
 * triangles, crosses, diamonds, and soft craters, spread around
 * the full circle with every kind guaranteed present.
 */
export function planetShapes(seed: number, count: number): PlanetShape[] {
  const rand = mulberry32(seed * 104729 + 17);
  return Array.from({ length: count }, () => ({
    kind: PLANET_KINDS[Math.floor(rand() * PLANET_KINDS.length)] ?? "ring",
    angle: rand() * Math.PI * 2,
    depth: 0.06 + rand() * 0.59,
    size: 7 + rand() * 13,
    phase: rand() * Math.PI * 2,
  })).map((shape, index) =>
    // Guarantee the mix reads: cycle kinds so no kind is missing.
    index < PLANET_KINDS.length
      ? { ...shape, kind: PLANET_KINDS[index] ?? shape.kind }
      : shape,
  );
}
