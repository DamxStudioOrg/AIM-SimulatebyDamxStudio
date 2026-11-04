import { describe, expect, it } from "vitest";
import { depthKey, fitCamera, isoDiscRadii, project, shade, toCss } from "./iso";

describe("project", () => {
  it("maps the world origin to the camera centre", () => {
    expect(project({ scale: 10, cx: 320, cy: 320 }, 0, 0, 0)).toEqual({
      x: 320,
      y: 320,
    });
  });

  it("runs +x right-down, +z left-down, +y straight up", () => {
    const cam = { scale: 10, cx: 0, cy: 0 };
    const px = project(cam, 1, 0, 0);
    const pz = project(cam, 0, 0, 1);
    const py = project(cam, 0, 1, 0);
    expect(px.x).toBeGreaterThan(0);
    expect(px.y).toBeGreaterThan(0);
    expect(pz.x).toBeLessThan(0);
    expect(pz.y).toBeGreaterThan(0);
    expect(py.x).toBeCloseTo(0, 10);
    expect(py.y).toBeCloseTo(-10, 10);
  });

  it("matches the dimetric constants", () => {
    const cam = { scale: 2, cx: 0, cy: 0 };
    const p = project(cam, 3, 1, 1);
    expect(p.x).toBeCloseTo((3 - 1) * Math.cos(Math.PI / 6) * 2, 10);
    expect(p.y).toBeCloseTo((3 + 1) * 0.5 * 2 - 1 * 2, 10);
  });

  it("yaws the ground plane about Y", () => {
    const cam = { scale: 10, cx: 0, cy: 0 };
    const yawed = project(cam, 1, 0, 0, { az: Math.PI / 2, el: Math.asin(0.5) });
    const plain = project(cam, 0, 0, -1);
    expect(yawed.x).toBeCloseTo(plain.x, 10);
    expect(yawed.y).toBeCloseTo(plain.y, 10);
  });

  it("widens the ground squash with elevation", () => {
    const cam = { scale: 10, cx: 0, cy: 0 };
    const low = project(cam, 2, 0, 2);
    const high = project(cam, 2, 0, 2, { az: 0, el: Math.asin(1) });
    expect(high.y).toBeCloseTo(low.y * 2, 10);
  });
});

describe("fitCamera", () => {
  it("keeps the whole ground rect plus height inside the square", () => {
    const cam = fitCamera(640, { minX: -11, maxX: 11, minZ: -9, maxZ: 9 }, 7, 24);
    const corners: [number, number, number][] = [];
    for (const x of [-11, 11]) {
      for (const z of [-9, 9]) {
        corners.push([x, 0, z], [x, 7, z]);
      }
    }
    for (const [x, y, z] of corners) {
      const p = project(cam, x, y, z);
      expect(p.x).toBeGreaterThanOrEqual(24 - 1e-6);
      expect(p.x).toBeLessThanOrEqual(640 - 24 + 1e-6);
      expect(p.y).toBeGreaterThanOrEqual(24 - 1e-6);
      expect(p.y).toBeLessThanOrEqual(640 - 24 + 1e-6);
    }
  });

  it("fills the square: one extent touches the margin", () => {
    const cam = fitCamera(640, { minX: -11, maxX: 11, minZ: -9, maxZ: 9 }, 7, 24);
    const corners: [number, number, number][] = [];
    for (const x of [-11, 11]) {
      for (const z of [-9, 9]) {
        corners.push([x, 0, z], [x, 7, z]);
      }
    }
    const xs = corners.map(([x, y, z]) => project(cam, x, y, z).x);
    const ys = corners.map(([x, y, z]) => project(cam, x, y, z).y);
    const spanX = Math.max(...xs) - Math.min(...xs);
    const spanY = Math.max(...ys) - Math.min(...ys);
    expect(Math.max(spanX, spanY)).toBeCloseTo(640 - 48, 6);
  });
});

describe("isoDiscRadii", () => {
  it("projects a ground circle to the dimetric ellipse", () => {
    const { rx, ry } = isoDiscRadii(5, 10);
    expect(rx).toBeCloseTo(Math.SQRT2 * Math.cos(Math.PI / 6) * 50, 10);
    expect(ry).toBeCloseTo(Math.SQRT2 * 0.5 * 50, 10);
  });
});

describe("depthKey", () => {
  it("sorts far (small x+z) before near", () => {
    expect(depthKey(-10, -8)).toBeLessThan(depthKey(10, 8));
    expect(depthKey(0, 0)).toBe(0);
  });
});

describe("toCss + shade", () => {
  it("formats hex colors as css", () => {
    expect(toCss(0xff4f4f)).toBe("#ff4f4f");
    expect(toCss(0x0)).toBe("#000000");
  });

  it("shades toward black and white deterministically", () => {
    expect(shade(0xff0000, 1)).toBe("#ff0000");
    expect(shade(0xff0000, 0.5)).toBe("#800000");
    expect(shade(0x000000, 2)).toBe("#000000");
  });
});
