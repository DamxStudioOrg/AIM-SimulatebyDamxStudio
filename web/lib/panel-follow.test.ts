import { describe, expect, it } from "vitest";

import { followTarget } from "./panel-follow";

describe("followTarget", () => {
  it("rests at the top while the section arrives", () => {
    // Section top exactly at the viewport's bottom edge.
    expect(followTarget(800, 600, 800, 400)).toBe(0);
  });

  it("sits at the bottom once the section departs", () => {
    // Section bottom exactly at the viewport's top edge.
    expect(followTarget(-600, 600, 800, 400)).toBe(400);
  });

  it("drifts halfway at the midpoint", () => {
    // Section centered: top at (800 - 600) / 2 = 100.
    expect(followTarget(100, 600, 800, 400)).toBe(200);
  });

  it("clamps past either edge", () => {
    expect(followTarget(2000, 600, 800, 400)).toBe(0);
    expect(followTarget(-2000, 600, 800, 400)).toBe(400);
  });

  it("declines without overflow, viewport, or section", () => {
    expect(followTarget(100, 600, 800, 0)).toBeNull();
    expect(followTarget(100, 600, 0, 400)).toBeNull();
    expect(followTarget(100, 0, 800, 400)).toBeNull();
  });
});
