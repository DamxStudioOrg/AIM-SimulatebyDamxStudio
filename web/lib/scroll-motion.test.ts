import { describe, expect, it } from "vitest";
import { pickLitId, slideParallax } from "./scroll-motion";

describe("slideParallax", () => {
  it("rests neutral and fully opaque at dead center", () => {
    expect(slideParallax(0.5)).toEqual({ y: 0, opacity: 1 });
  });

  it("drifts down and fades toward the top edge", () => {
    const style = slideParallax(0);
    expect(style.y).toBeCloseTo(14, 5);
    expect(style.opacity).toBeCloseTo(0.35, 5);
  });

  it("drifts up and fades toward the bottom edge", () => {
    const style = slideParallax(1);
    expect(style.y).toBeCloseTo(-14, 5);
    expect(style.opacity).toBeCloseTo(0.35, 5);
  });

  it("keeps full opacity through the middle band", () => {
    expect(slideParallax(0.3).opacity).toBe(1);
    expect(slideParallax(0.7).opacity).toBe(1);
  });

  it("clamps ratios outside the container instead of flinging", () => {
    expect(slideParallax(-2)).toEqual(slideParallax(0));
    expect(slideParallax(3)).toEqual(slideParallax(1));
  });
});

describe("pickLitId", () => {
  it("lights the most visible block", () => {
    expect(
      pickLitId([
        { id: "a", ratio: 0.2, visible: true },
        { id: "b", ratio: 0.8, visible: true },
        { id: "c", ratio: 0.5, visible: true },
      ]),
    ).toBe("b");
  });

  it("ignores invisible blocks even with stale ratios", () => {
    expect(
      pickLitId([
        { id: "a", ratio: 0.9, visible: false },
        { id: "b", ratio: 0.1, visible: true },
      ]),
    ).toBe("b");
  });

  it("keeps the earliest block on ties so equals never flicker", () => {
    expect(
      pickLitId([
        { id: "a", ratio: 0.6, visible: true },
        { id: "b", ratio: 0.6, visible: true },
      ]),
    ).toBe("a");
  });

  it("lights nothing when no block is visible", () => {
    expect(
      pickLitId([
        { id: "a", ratio: 0, visible: false },
        { id: "b", ratio: 0, visible: false },
      ]),
    ).toBeNull();
    expect(pickLitId([])).toBeNull();
  });
});
