import type { Application } from "pixi.js";
import { describe, expect, it, vi } from "vitest";
import {
  BACKDROP_STOPS,
  GLOW_STAR_COUNT,
  MOON_BUBBLE_FEATHER_PX,
  PLANET,
  PLANET_BOB_PX,
  PLANET_COVER_SLACK_PX,
  PLANET_LIMB_TOP_PX,
  PLANET_PANEL_INSET_PX,
  discHalfChord,
  glowStarX,
  isGlowStar,
  lanePlanetInset,
  limbFade,
  moonHole,
  panelMeasureWidth,
  planetCenterY,
  planetDepth,
  planetPanel,
  planetRadius,
  planetShapes,
  starField,
  stippleField,
  suspendApp,
} from "./site-background";

const W = 1200;
const H = 800;

describe("planet disc", () => {
  it("scores depth 1 at the center and negative in the void corners", () => {
    expect(planetDepth(PLANET.cx * W, planetCenterY(W, H), W, H, 0)).toBeCloseTo(1, 3);
    expect(planetDepth(0, 0, W, H, 0)).toBeLessThan(0);
    expect(planetDepth(W, 0, W, H, 0)).toBeLessThan(0);
  });

  it("covers the full height below the header on any aspect", () => {
    const cases: [number, number][] = [
      [1440, 1050],
      [1200, 800],
      [390, 844],
      [768, 1024],
    ];
    for (const [w, h] of cases) {
      expect(planetCenterY(w, h) + planetRadius(w, h)).toBeGreaterThanOrEqual(h);
    }
  });

  it("keeps the bottom covered at the top of the bob", () => {
    const cases: [number, number][] = [
      [1440, 1050],
      [1200, 800],
      [390, 844],
      [768, 1024],
      [2560, 1080],
    ];
    expect(PLANET_COVER_SLACK_PX).toBeGreaterThan(PLANET_BOB_PX);
    for (const [w, h] of cases) {
      expect(
        planetCenterY(w, h) + planetRadius(w, h) - PLANET_BOB_PX,
      ).toBeGreaterThanOrEqual(h);
    }
  });

  it("rides 1px under the viewport top on any aspect", () => {
    expect(PLANET_LIMB_TOP_PX).toBe(1);
    const cases: [number, number][] = [
      [1440, 1050],
      [1200, 800],
      [390, 844],
      [768, 1024],
    ];
    for (const [w, h] of cases) {
      expect(planetCenterY(w, h) - planetRadius(w, h)).toBeCloseTo(
        PLANET_LIMB_TOP_PX,
        5,
      );
    }
  });

  it("blurs objects in from the limb", () => {
    expect(limbFade(0)).toBe(1);
    expect(limbFade(0.85)).toBe(1);
    expect(limbFade(1)).toBe(0);
    expect(limbFade(1.4)).toBe(0);
    const mid = limbFade(0.925);
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(1);
    expect(limbFade(0.9)).toBeGreaterThan(limbFade(0.97));
  });
});

describe("moonHole", () => {
  it("centers on the figure with the lane added to the half min-side", () => {
    expect(moonHole({ x: 10, y: 20, width: 480, height: 520 }, 40)).toEqual({
      x: 250,
      y: 280,
      r: 280,
    });
  });

  it("pins the shared bubble feather", () => {
    expect(MOON_BUBBLE_FEATHER_PX).toBe(12);
  });
});

describe("planetPanel", () => {
  it("shares one center axis with the planet panel and the writeup", () => {
    // Ambient axis: the backdrop disc centers at 55% of the viewport
    // width, over the controls panel's left half.
    expect(PLANET.cx).toBe(0.55);
    expect(planetPanel(W, H).x).toBe(0.1 * W + (0.9 * W) / 2);
  });

  it("holds the side axis at phone sizes too — moon never stacks", () => {
    expect(planetPanel(390, 844).x).toBe(PLANET.cx * 390);
  });

  it("sits concentric with the planet, inset from the rim", () => {
    expect(PLANET_PANEL_INSET_PX).toBeGreaterThan(0);
    const panel = planetPanel(W, H);
    expect(panel.x).toBe(PLANET.cx * W);
    expect(panel.y).toBe(planetCenterY(W, H));
    expect(panel.r).toBe(planetRadius(W, H) - PLANET_PANEL_INSET_PX);
  });
});

describe("discHalfChord", () => {
  it("spans the radius at the center line", () => {
    expect(discHalfChord(100, 50, 100)).toBe(50);
  });

  it("follows pythagoras off-center", () => {
    expect(discHalfChord(100, 50, 130)).toBe(40);
    expect(discHalfChord(100, 50, 70)).toBe(40);
  });

  it("vanishes at and past the edge", () => {
    expect(discHalfChord(100, 50, 150)).toBe(0);
    expect(discHalfChord(100, 50, 200)).toBe(0);
  });
});

describe("panelMeasureWidth", () => {
  it("matches the panel chord at the viewport middle", () => {
    const panel = planetPanel(W, H);
    const dy = Math.abs(H / 2 - panel.y);
    const chord = 2 * Math.sqrt(panel.r * panel.r - dy * dy);
    expect(panelMeasureWidth(W, H)).toBeCloseTo(Math.min(chord, W), 6);
  });

  it("pins the desktop measures", () => {
    expect(panelMeasureWidth(1440, 900)).toBeCloseTo(1349.3, 0);
    expect(panelMeasureWidth(1440, 700)).toBeCloseTo(1026.4, 0);
  });

  it("caps at the viewport on tall screens", () => {
    expect(panelMeasureWidth(800, 1600)).toBe(800);
  });
});

describe("lanePlanetInset", () => {
  it("stays at the edge when the disc covers it", () => {
    expect(lanePlanetInset(1440, 900, 552, 252, 16)).toBe(0);
  });

  it("steps inside the disc on short viewports", () => {
    expect(lanePlanetInset(1440, 700, 408, 196, 16)).toBeCloseTo(70.7, 0);
  });

  it("stays at the edge past the disc", () => {
    expect(lanePlanetInset(1440, 700, 0, 10, 16)).toBe(0);
  });
});

describe("suspendApp", () => {
  it("stops the ticker and frees the scene but never the renderer", () => {
    // Regression: Pixi's destroy() unconditionally loses the canvas
    // GL context, and remounts reuse the same canvas nodes — a
    // destroyed context poisons every later mount white.
    const ticker = { stop: vi.fn() };
    const stage = { destroy: vi.fn() };
    const renderer = { destroy: vi.fn() };
    suspendApp({ ticker, stage, renderer } as unknown as Application);
    expect(ticker.stop).toHaveBeenCalledTimes(1);
    expect(stage.destroy).toHaveBeenCalledWith({ children: true });
    expect(renderer.destroy).not.toHaveBeenCalled();
  });
});

describe("starField", () => {
  it("is deterministic and stays outside the planet", () => {
    const a = starField(7, 120, W, H);
    expect(a).toEqual(starField(7, 120, W, H));
    expect(a).not.toEqual(starField(8, 120, W, H));
    expect(a.length).toBeGreaterThan(80);
    for (const star of a) {
      expect(planetDepth(star.x, star.y, W, H, 0)).toBeLessThan(0);
      expect(star.alpha).toBeGreaterThan(0);
      expect(star.alpha).toBeLessThanOrEqual(1);
    }
  });
});

describe("glowStars", () => {
  it("selects a few leading stars that drift right-to-left and wrap", () => {
    expect(GLOW_STAR_COUNT).toBeGreaterThan(0);
    expect(isGlowStar(0)).toBe(true);
    expect(isGlowStar(GLOW_STAR_COUNT)).toBe(false);
    expect(glowStarX(600, 0, W, false)).toBe(600);
    expect(glowStarX(600, 1000, W, false)).toBeLessThan(600);
    expect(glowStarX(5, 60000, W, false)).toBeGreaterThanOrEqual(0);
    expect(glowStarX(5, 60000, W, false)).toBeLessThanOrEqual(W);
    expect(glowStarX(600, 99999, W, true)).toBe(600);
  });
});

describe("stippleField", () => {
  it("packs the planet in brand tokens, denser near the rim", () => {
    const dots = stippleField(7, 4000);
    expect(dots.length).toBeGreaterThan(400);
    expect(dots).toEqual(stippleField(7, 4000));
    for (const dot of dots) {
      expect(dot.radial).toBeGreaterThanOrEqual(0);
      expect(dot.radial).toBeLessThanOrEqual(1);
      expect(BACKDROP_STOPS).toContain(dot.color);
    }
    const nearRim = dots.filter((dot) => dot.radial > 0.9);
    const inner = dots.filter((dot) => dot.radial < 0.5);
    expect(nearRim.length).toBeGreaterThan(inner.length);
  });
});

describe("planetShapes", () => {
  it("is deterministic and mixes every kind inside the planet", () => {
    const shapes = planetShapes(7, 14);
    expect(shapes).toEqual(planetShapes(7, 14));
    expect(new Set(shapes.map((shape) => shape.kind)).size).toBe(5);
    for (const shape of shapes) {
      expect(shape.angle).toBeGreaterThanOrEqual(0);
      expect(shape.angle).toBeLessThan(Math.PI * 2);
      expect(shape.depth).toBeGreaterThan(0);
      expect(shape.depth).toBeLessThanOrEqual(1);
      expect(shape.size).toBeGreaterThan(0);
    }
  });
});

describe("panelPadTop", () => {
  it("holds the title below the panel apex on desktop", async () => {
    const { panelPadTop } = await import("./site-background");
    // Panel apex at viewport y 49 (1px limb + 48px inset; the cover
    // slack cancels); rail at doc 40: pad 17.
    expect(panelPadTop(1440, 900, 40)).toBe(17);
  });

  it("pads nothing when the rail starts below the apex", async () => {
    const { panelPadTop } = await import("./site-background");
    expect(panelPadTop(1440, 900, 500)).toBe(0);
  });

  it("holds the same apex on tall viewports", async () => {
    const { panelPadTop } = await import("./site-background");
    // The apex no longer drops with height: same pad everywhere.
    expect(panelPadTop(2560, 1312, 40)).toBe(17);
  });
});
