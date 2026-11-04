import { describe, expect, it } from "vitest";
import {
  HEATMAP_THEME,
  allocationGrid,
  gridPeak,
  gridSummary,
  heatColor,
} from "./allocation-grid";
import type { MatchTurn } from "./sim";

function turn(overrides: Partial<MatchTurn> = {}): MatchTurn {
  return {
    turn: 1,
    state_hash: "abc",
    skip_reason: null,
    tokens_used: 10,
    usage_anomaly: false,
    spend: 100,
    allocation: null,
    policies: [],
    ...overrides,
  };
}

describe("allocationGrid", () => {
  it("normalizes each turn to shares", () => {
    const grid = allocationGrid([
      turn({ turn: 1, allocation: { rescue: 75, housing: 25 } }),
    ]);
    const rescue = grid.cells[5] ?? [];
    const housing = grid.cells[0] ?? [];
    expect(rescue[0]).toBeCloseTo(0.75, 5);
    expect(housing[0]).toBeCloseTo(0.25, 5);
    expect(grid.max).toBeCloseTo(0.75, 5);
  });

  it("treats skipped turns as zeros", () => {
    const grid = allocationGrid([turn({ turn: 1, skip_reason: "invalid_output" })]);
    expect(grid.cells.flat().every((cell) => cell === 0)).toBe(true);
    expect(grid.max).toBe(0);
  });

  it("handles an empty run", () => {
    const grid = allocationGrid([]);
    expect(grid.cells).toHaveLength(8);
    expect(grid.max).toBe(0);
  });
});

describe("gridPeak", () => {
  it("finds the hottest key and turn", () => {
    const grid = allocationGrid([
      turn({ turn: 1, allocation: { housing: 100 } }),
      turn({ turn: 2, allocation: { rescue: 60, housing: 40 } }),
    ]);
    expect(gridPeak(grid)).toEqual({ key: "housing", turn: 1, share: 1 });
  });

  it("is null when nothing was allocated", () => {
    expect(gridPeak(allocationGrid([turn()]))).toBeNull();
  });
});

describe("gridSummary", () => {
  it("names the peak and the shocks", () => {
    const grid = allocationGrid([
      turn({ turn: 1, allocation: { rescue: 38, housing: 62 } }),
    ]);
    expect(gridSummary(grid)).toContain("housing 62 percent at turn 1");
    expect(gridSummary(grid)).toContain("turn 5");
    expect(gridSummary(grid)).toContain("turn 9");
  });

  it("says plainly when every turn was skipped", () => {
    expect(gridSummary(allocationGrid([turn()]))).toContain("skipped");
  });
});

describe("heatColor", () => {
  it("uses the cold token at zero and the hot token at full share", () => {
    expect(heatColor(0)).toBe(HEATMAP_THEME.cellCold);
    expect(heatColor(1)).toBe("rgb(255,230,77)");
    expect(heatColor(2)).toBe("rgb(255,230,77)");
  });

  it("interpolates toward hot as share grows", () => {
    expect(heatColor(0.5)).toBe("rgb(165,126,49)");
  });

  it("keeps the ramp on the brand tokens", () => {
    expect(HEATMAP_THEME.cellHot).toBe("#ffe64d");
    expect(HEATMAP_THEME.shock).toBe("#a33030");
  });
});
