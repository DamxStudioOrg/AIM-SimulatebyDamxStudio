"use client";

import { useEffect, useRef } from "react";
import { Application, Container, Graphics, Sprite, Texture } from "pixi.js";
import {
  BACKDROP_RIM,
  BACKDROP_SEED,
  BACKDROP_STAR,
  BACKDROP_STOPS,
  BACKDROP_VOID,
  GLOW_STAR_COUNT,
  MOON_BUBBLE_FEATHER_PX,
  PLANET,
  PLANET_BOB_PX,
  glowStarX,
  isGlowStar,
  limbFade,
  moonHole,
  panelMeasureWidth,
  planetCenterY,
  planetPanel,
  planetRadius,
  planetShapes,
  starField,
  stippleField,
  suspendApp,
} from "@/lib/site-background";
import type {
  BackdropDot,
  MoonHole,
  PlanetDot,
  PlanetShape,
} from "@/lib/site-background";

/** Stipple alpha resolution: one static bucket per color and step. */
const STIPPLE_ALPHA_STEPS = 16;
/** Star twinkle phases and base-brightness steps. */
const STAR_PHASE_BUCKETS = 8;
const STAR_ALPHA_STEPS = 4;
/** Field density caps, matching the old per-frame painter. */
const STIPPLE_MAX_ATTEMPTS = 14000;
const STIPPLE_DENSITY_PX = 260;
const STAR_MAX = 420;
const STAR_DENSITY_PX = 3800;
const PLANET_SHAPE_COUNT = 12;
/** Gradient sprite resolutions in pixels. */
const WASH_TEX_PX = 256;
const BUBBLE_TEX_PX = 128;
const GLOW_TEX_PX = 64;
const PANEL_TEX_PX = 128;
/** Glow halo diameter per unit of star radius. */
const GLOW_HALO_SCALE = 0.4;
/** Panel disc stays solid to this radius fraction, then softens. */
const PANEL_SOLID_UNTIL = 0.94;
/** The moon bubble re-tracks at most this often. */
const HOLE_TRACK_MS = 300;

interface RadialStop {
  offset: number;
  color: string;
}

/** Code-drawn radial sprite: concentric gradient, no shipped image. */
function radialTexture(size: number, stops: RadialStop[]): Texture {
  const tile = document.createElement("canvas");
  tile.width = size;
  tile.height = size;
  const ctx = tile.getContext("2d");
  if (ctx === null) {
    throw new Error("backdrop gradients need a 2d canvas context");
  }
  const gradient = ctx.createRadialGradient(
    size / 2,
    size / 2,
    0,
    size / 2,
    size / 2,
    size / 2,
  );
  for (const stop of stops) {
    gradient.addColorStop(stop.offset, stop.color);
  }
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);
  return Texture.from(tile);
}

/** Void wash: one flat brand-deep colour dissolving only at the limb. */
function washTexture(): Texture {
  return radialTexture(WASH_TEX_PX, [
    { offset: 0, color: "rgba(122, 35, 35, 0.16)" },
    { offset: 0.85, color: "rgba(122, 35, 35, 0.16)" },
    { offset: 1, color: "rgba(122, 35, 35, 0)" },
  ]);
}

/** Soft-edged void disc erasing the planet around the moon figure. */
function bubbleTexture(holeR: number): Texture {
  const edge = holeR / (holeR + MOON_BUBBLE_FEATHER_PX);
  return radialTexture(BUBBLE_TEX_PX, [
    { offset: 0, color: BACKDROP_VOID },
    { offset: edge, color: BACKDROP_VOID },
    { offset: 1, color: "rgba(13, 4, 4, 0)" },
  ]);
}

/** Glow-star head: bright core with a wide faint halo. */
function glowTexture(): Texture {
  return radialTexture(GLOW_TEX_PX, [
    { offset: 0, color: "rgba(255, 255, 255, 1)" },
    { offset: 0.15, color: "rgba(255, 255, 255, 0.9)" },
    { offset: 1, color: "rgba(255, 255, 255, 0)" },
  ]);
}

/** Panel disc: a dark soft disc grounding the planet field. */
function panelTexture(): Texture {
  return radialTexture(PANEL_TEX_PX, [
    { offset: 0, color: "rgba(13, 4, 4, 0.5)" },
    { offset: PANEL_SOLID_UNTIL, color: "rgba(13, 4, 4, 0.5)" },
    { offset: 1, color: "rgba(13, 4, 4, 0)" },
  ]);
}

function bucketize<T>(items: T[], key: (item: T) => string): Map<string, T[]> {
  const buckets = new Map<string, T[]>();
  for (const item of items) {
    const name = key(item);
    const bucket = buckets.get(name);
    if (bucket === undefined) {
      buckets.set(name, [item]);
    } else {
      bucket.push(item);
    }
  }
  return buckets;
}

/** Moon figure's void bubble in viewport coordinates, if on screen. */
function trackFigure(): MoonHole | null {
  // Arena view first (the sim moon), then the header brand moon:
  // the landing has no stage column, so without the fallback the
  // hole stays null and the planet wash paints under the moon.
  const figure =
    document.querySelector(".stage-col figure.stage3d") ??
    document.querySelector("figure.header-moon");
  if (figure === null) {
    return null;
  }
  const rect = figure.getBoundingClientRect();
  const style = getComputedStyle(figure);
  // The lane rides the bottom margin on desktop, the right margin
  // on mobile; the active one wins.
  const lane = Math.max(
    Number.parseFloat(style.marginRight) || 0,
    Number.parseFloat(style.marginBottom) || 0,
  );
  return moonHole(
    { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
    lane,
  );
}

interface ShapeActor {
  art: Graphics;
  shape: PlanetShape;
  fade: number;
}

interface StarBucket {
  art: Graphics;
  phase: number;
  base: number;
}

interface GlowActor {
  sprite: Sprite;
  star: BackdropDot;
}

interface BackdropScene {
  spin: Container;
  shapes: ShapeActor[];
  stars: StarBucket[];
  glow: GlowActor[];
  bubble: Sprite;
  bubbleR: number;
  radius: number;
  glowTex: Texture;
}

/** Dots baked in planet-local pixels; the spin layer rotates them. */
function buildStipple(spin: Container, dots: PlanetDot[], radius: number): void {
  const visible = dots.filter((dot) => dot.alpha * limbFade(dot.radial) > 0);
  const buckets = bucketize(
    visible,
    (dot) =>
      `${dot.color}|${String(Math.min(STIPPLE_ALPHA_STEPS - 1, Math.floor(dot.alpha * limbFade(dot.radial) * STIPPLE_ALPHA_STEPS)))}`,
  );
  for (const [name, members] of buckets) {
    const [color, step] = name.split("|") as [string, string];
    const art = new Graphics();
    for (const dot of members) {
      const local = radius * dot.radial;
      art.circle(local * Math.cos(dot.angle), local * Math.sin(dot.angle), dot.r);
    }
    art.fill({
      color,
      alpha: (Number.parseInt(step, 10) + 0.5) / STIPPLE_ALPHA_STEPS,
    });
    spin.addChild(art);
  }
}

function strokeShape(art: Graphics, shape: PlanetShape, fade: number): void {
  const s = shape.size;
  const style = { color: BACKDROP_RIM, width: 1.4, alpha: 0.3 * fade };
  if (shape.kind === "crater") {
    art.circle(0, 0, s);
    art.fill({ color: BACKDROP_STOPS[3], alpha: 0.32 * fade });
    art.arc(0, 0, s, Math.PI * 1.05, Math.PI * 1.7);
    art.stroke({ color: BACKDROP_RIM, width: 1.4, alpha: 0.28 * fade });
    return;
  }
  if (shape.kind === "ring") {
    art.circle(0, 0, s * 0.7);
  } else if (shape.kind === "triangle") {
    art.moveTo(0, -s * 0.8);
    art.lineTo(s * 0.75, s * 0.6);
    art.lineTo(-s * 0.75, s * 0.6);
    art.closePath();
  } else if (shape.kind === "cross") {
    art.moveTo(-s * 0.7, 0);
    art.lineTo(s * 0.7, 0);
    art.moveTo(0, -s * 0.7);
    art.lineTo(0, s * 0.7);
  } else {
    art.moveTo(0, -s * 0.85);
    art.lineTo(s * 0.62, 0);
    art.lineTo(0, s * 0.85);
    art.lineTo(-s * 0.62, 0);
    art.closePath();
  }
  art.stroke(style);
}

/** Shapes drift inside the spin layer; twinkle buckets stay screen-fixed. */
function buildShapes(spin: Container, shapes: PlanetShape[]): ShapeActor[] {
  return shapes.map((shape) => {
    const fade = limbFade(1 - shape.depth);
    const art = new Graphics();
    strokeShape(art, shape, fade);
    spin.addChild(art);
    return { art, shape, fade };
  });
}

function buildStars(
  stage: Container,
  stars: BackdropDot[],
  glowTex: Texture,
): { buckets: StarBucket[]; glow: GlowActor[] } {
  const buckets: StarBucket[] = [];
  const plain = stars.filter((_, index) => !isGlowStar(index));
  const groups = bucketize(
    plain,
    (star) =>
      `${String(Math.floor((star.phase / (Math.PI * 2)) * STAR_PHASE_BUCKETS))}|${String(Math.min(STAR_ALPHA_STEPS - 1, Math.floor(star.alpha * STAR_ALPHA_STEPS)))}`,
  );
  for (const [name, members] of groups) {
    const [phaseStep, alphaStep] = name.split("|") as [string, string];
    const art = new Graphics();
    for (const star of members) {
      art.circle(star.x, star.y, star.r);
    }
    const base = (Number.parseInt(alphaStep, 10) + 0.5) / STAR_ALPHA_STEPS;
    art.fill({ color: BACKDROP_STAR, alpha: base });
    stage.addChild(art);
    buckets.push({
      art,
      phase:
        ((Number.parseInt(phaseStep, 10) + 0.5) / STAR_PHASE_BUCKETS) * Math.PI * 2,
      base,
    });
  }
  const glow = stars
    .filter((_, index) => isGlowStar(index))
    .slice(0, GLOW_STAR_COUNT)
    .map((star) => {
      const sprite = new Sprite(glowTex);
      sprite.anchor.set(0.5);
      sprite.scale.set(star.r * GLOW_HALO_SCALE);
      sprite.position.set(star.x, star.y);
      stage.addChild(sprite);
      return { sprite, star };
    });
  return { buckets, glow };
}

function clearStage(stage: Container): void {
  for (const child of [...stage.children]) {
    stage.removeChild(child);
    child.destroy({ children: true });
  }
}

/**
 * Backdrop layers, back to front: the spin layer closing over
 * wash, stipple, and shapes; the moon bubble; twinkling stars;
 * drifting glow.
 */
function buildBackdrop(
  app: Application,
  width: number,
  height: number,
  wash: Texture,
  glowTex: Texture,
  panelTex: Texture,
): BackdropScene {
  clearStage(app.stage);
  const radius = planetRadius(width, height);
  const spin = new Container();
  const washSprite = new Sprite(wash);
  washSprite.anchor.set(0.5);
  washSprite.scale.set((radius * 2) / WASH_TEX_PX);
  spin.addChild(washSprite);
  const attempts = Math.min(
    STIPPLE_MAX_ATTEMPTS,
    Math.round((width * height) / STIPPLE_DENSITY_PX),
  );
  buildStipple(spin, stippleField(BACKDROP_SEED, attempts), radius);
  const shapes = buildShapes(spin, planetShapes(BACKDROP_SEED, PLANET_SHAPE_COUNT));
  app.stage.addChild(spin);
  const bubble = new Sprite(Texture.EMPTY);
  bubble.anchor.set(0.5);
  bubble.visible = false;
  app.stage.addChild(bubble);
  const panel = planetPanel(width, height);
  const panelSprite = new Sprite(panelTex);
  panelSprite.anchor.set(0.5);
  panelSprite.position.set(panel.x, panel.y);
  panelSprite.scale.set((panel.r * 2) / PANEL_TEX_PX);
  app.stage.addChild(panelSprite);
  const starCount = Math.min(STAR_MAX, Math.round((width * height) / STAR_DENSITY_PX));
  const { buckets, glow } = buildStars(
    app.stage,
    starField(BACKDROP_SEED, starCount, width, height),
    glowTex,
  );
  return {
    spin,
    shapes,
    stars: buckets,
    glow,
    bubble,
    bubbleR: -1,
    radius,
    glowTex,
  };
}

function updateBackdrop(
  scene: BackdropScene,
  time: number,
  width: number,
  height: number,
  hole: MoonHole | null,
  reduced: boolean,
): void {
  const spin = reduced ? 0 : time * PLANET.spin;
  const bob = reduced ? 0 : Math.sin(time * 0.00045) * PLANET_BOB_PX;
  scene.spin.position.set(PLANET.cx * width, planetCenterY(width, height) + bob);
  scene.spin.rotation = spin;
  for (const actor of scene.shapes) {
    const wobble = reduced ? 0 : Math.sin(time * 0.00021 + actor.shape.phase) * 0.03;
    const local = scene.radius * (1 - actor.shape.depth);
    const angle = actor.shape.angle + wobble;
    actor.art.position.set(local * Math.cos(angle), local * Math.sin(angle));
    actor.art.rotation = reduced
      ? actor.shape.phase
      : actor.shape.phase + time * 0.00004;
  }
  for (const bucket of scene.stars) {
    bucket.art.alpha = reduced
      ? 1
      : 0.72 + 0.28 * Math.sin(time * 0.0016 + bucket.phase * 7);
  }
  for (const actor of scene.glow) {
    actor.sprite.position.x = glowStarX(actor.star.x, time, width, reduced);
  }
  if (hole === null || hole.r <= 0) {
    scene.bubble.visible = false;
    return;
  }
  scene.bubble.visible = true;
  scene.bubble.position.set(hole.x, hole.y);
  const rounded = Math.round(hole.r);
  if (rounded !== scene.bubbleR) {
    scene.bubbleR = rounded;
    const previous = scene.bubble.texture;
    scene.bubble.texture = bubbleTexture(rounded);
    if (previous !== Texture.EMPTY) {
      previous.destroy();
    }
  }
  scene.bubble.scale.set(((hole.r + MOON_BUBBLE_FEATHER_PX) * 2) / BUBBLE_TEX_PX);
}

/**
 * Static 2D fallback: void + planet wash + the tested star math in
 * one paint. Used only when Pixi init fails (no WebGL); the canvas
 * is marked data-backdrop="static" and the failure is logged, never
 * silent. False when even 2D is unavailable.
 */
function paintStaticBackdrop(canvas: HTMLCanvasElement): boolean {
  const width = window.innerWidth;
  const height = window.innerHeight;
  const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
  canvas.width = Math.max(1, Math.floor(width * dpr));
  canvas.height = Math.max(1, Math.floor(height * dpr));
  const ctx = canvas.getContext("2d");
  if (ctx === null) {
    return false;
  }
  ctx.scale(dpr, dpr);
  ctx.fillStyle = BACKDROP_VOID;
  ctx.fillRect(0, 0, width, height);
  const cx = PLANET.cx * width;
  const cy = planetCenterY(width, height);
  const radius = planetRadius(width, height);
  const wash = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
  wash.addColorStop(0, "rgba(122, 35, 35, 0.16)");
  wash.addColorStop(0.85, "rgba(122, 35, 35, 0.16)");
  wash.addColorStop(1, "rgba(122, 35, 35, 0)");
  ctx.fillStyle = wash;
  ctx.fillRect(0, 0, width, height);
  for (const star of starField(BACKDROP_SEED, 420, width, height)) {
    ctx.globalAlpha = Math.min(1, star.alpha);
    ctx.fillStyle = star.color;
    ctx.beginPath();
    ctx.arc(star.x, star.y, star.r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  return true;
}

/**
 * Fixed website backdrop: one giant planet, layered in Pixi on a
 * single canvas. The 360° disc rotates slowly with a gentle bob,
 * stars twinkle in the void, and faint shapes drift inside the
 * stipple; a void bubble around the moon figure keeps the planet
 * wash out from under it by the lane gap. No outer ring: the disc
 * dissolves at the limb into the void. `prefers-reduced-motion`
 * renders one static frame. Drawn from the token palette in code —
 * never a shipped image. A Pixi init failure logs honestly and
 * paints the static 2D fallback, marked on the canvas.
 */
export default function SiteBackground(): React.ReactElement {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null) {
      return;
    }
    const canvasEl: HTMLCanvasElement = canvas;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let cancelled = false;
    let backdrop: Application | null = null;
    let backdropReady = false;
    let scene: BackdropScene | null = null;
    let wash: Texture | null = null;
    let glowTex: Texture | null = null;
    let panelTex: Texture | null = null;
    let hole: MoonHole | null = null;
    let holeAt = -HOLE_TRACK_MS;
    let staticMode = false;

    function track(time: number): void {
      if (time - holeAt < HOLE_TRACK_MS && hole !== null) {
        return;
      }
      holeAt = time;
      hole = trackFigure();
    }

    // The writeup measure follows the panel chord, so copy stays
    // inside the planet on every viewport. Synchronous: no Pixi
    // needed, runs before first paint settles and on every resize.
    // Floored: rounding up would poke a pixel past the white line.
    function applyMeasure(): void {
      const width = window.innerWidth;
      const height = window.innerHeight;
      document.documentElement.style.setProperty(
        "--panel-measure",
        `${String(Math.floor(panelMeasureWidth(width, height)))}px`,
      );
    }

    function layout(app: Application): { width: number; height: number } {
      const width = window.innerWidth;
      const height = window.innerHeight;
      const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
      app.renderer.resolution = dpr;
      app.renderer.resize(width, height);
      return { width, height };
    }

    function tickBackdrop(time: number): void {
      track(time);
      if (scene === null) {
        return;
      }
      updateBackdrop(scene, time, window.innerWidth, window.innerHeight, hole, reduced);
    }

    function stopAfterFrame(app: Application): void {
      app.ticker.start();
      app.ticker.addOnce(() => {
        app.ticker.stop();
      });
    }

    // Idempotent teardown: the initialized app is suspended, never
    // destroyed — destroy() loses the canvas GL context and remounts
    // reuse the same canvas node. Every handle is nulled so a
    // racing start() or cleanup can call this twice safely
    // (StrictMode mounts twice in dev).
    function teardown(): void {
      if (backdrop !== null) {
        const app = backdrop;
        backdrop = null;
        if (backdropReady) {
          backdropReady = false;
          suspendApp(app);
        }
      }
      if (wash !== null) {
        const texture = wash;
        wash = null;
        texture.destroy();
      }
      if (glowTex !== null) {
        const texture = glowTex;
        glowTex = null;
        texture.destroy();
      }
      if (panelTex !== null) {
        const texture = panelTex;
        panelTex = null;
        texture.destroy();
      }
      if (scene !== null) {
        scene = null;
      }
    }

    function onResize(): void {
      applyMeasure();
      if (staticMode) {
        paintStaticBackdrop(canvasEl);
        return;
      }
      if (
        backdrop === null ||
        scene === null ||
        wash === null ||
        glowTex === null ||
        panelTex === null
      ) {
        return;
      }
      const { width, height } = layout(backdrop);
      if (scene.bubble.texture !== Texture.EMPTY) {
        scene.bubble.texture.destroy();
      }
      scene = buildBackdrop(backdrop, width, height, wash, glowTex, panelTex);
      if (reduced) {
        tickBackdrop(0);
        stopAfterFrame(backdrop);
      }
    }

    // The moon scrolls with the page, so the hole re-tracks on scroll too —
    // the ticker's 300ms throttle would otherwise lag the void behind it.
    function onScroll(): void {
      track(performance.now());
    }

    async function start(): Promise<void> {
      const app = new Application();
      backdrop = app;
      const settling = app.init({
        canvas: canvasEl,
        background: BACKDROP_VOID,
        antialias: true,
      });
      try {
        // A hanging init (stalled adapter, wedged GPU) must not leave
        // a flat void forever: race it so the static fallback wins.
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
          await Promise.race([
            settling,
            new Promise<never>((_resolve, reject) => {
              timer = setTimeout(() => {
                reject(new Error("Pixi init timed out"));
              }, 15000);
            }),
          ]);
        } finally {
          clearTimeout(timer);
        }
        backdropReady = true;
      } catch (error: unknown) {
        teardown();
        // A late-resolving init must not blank the static paint.
        void settling.then(
          () => {
            if (staticMode) {
              paintStaticBackdrop(canvasEl);
            }
          },
          () => undefined,
        );
        if (paintStaticBackdrop(canvasEl)) {
          staticMode = true;
          canvasEl.dataset.backdrop = "static";
          console.error("[backdrop] Pixi init failed; painted static fallback", error);
        } else {
          console.error("[backdrop] Pixi init failed; leaving the void", error);
        }
        return;
      }
      if (cancelled) {
        // Cleanup ran mid-init and already nulled the shared refs;
        // the app is fully initialized here, so suspend it
        // directly instead of leaking a live ticker.
        suspendApp(app);
        backdropReady = false;
        return;
      }
      try {
        wash = washTexture();
        glowTex = glowTexture();
        panelTex = panelTexture();
        const { width, height } = layout(app);
        scene = buildBackdrop(app, width, height, wash, glowTex, panelTex);
        canvasEl.dataset.backdrop = "pixi";
        tickBackdrop(0);
      } catch (error: unknown) {
        console.error("[backdrop] Pixi scene failed; leaving the void", error);
        teardown();
        return;
      }
      if (reduced) {
        stopAfterFrame(app);
        return;
      }
      app.ticker.add((ticker) => {
        tickBackdrop(ticker.lastTime);
      });
    }

    applyMeasure();
    void start();
    window.addEventListener("resize", onResize);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      cancelled = true;
      window.removeEventListener("resize", onResize);
      window.removeEventListener("scroll", onScroll);
      teardown();
    };
  }, []);

  return (
    <>
      <canvas ref={canvasRef} className="site-bg" aria-hidden="true" />
      <div className="site-noise" aria-hidden="true" />
    </>
  );
}
