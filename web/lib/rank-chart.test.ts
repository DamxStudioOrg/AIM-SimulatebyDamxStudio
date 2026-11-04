import { describe, expect, it } from "vitest";
import { chartRows, rankSummary } from "./rank-chart";
import type { RanksSnapshot } from "./server-board";

function snapshot(overrides: Partial<RanksSnapshot> = {}): RanksSnapshot {
  return {
    game: "city",
    metric: "impact",
    challenge: "",
    failed: false,
    rows: [
      { position: 1, name: "Rusty", value: 41.3, you: false },
      { position: 2, name: "Me", value: 20.6, you: true },
      { position: 3, name: "Zed", value: 0, you: false },
    ],
    ...overrides,
  };
}

describe("chartRows", () => {
  it("normalizes against the top value and caps at eight", () => {
    const rows = chartRows(snapshot());
    expect(rows).toHaveLength(3);
    expect(rows[0]?.width01).toBeCloseTo(1, 5);
    expect(rows[1]?.width01).toBeCloseTo(20.6 / 41.3, 5);
    expect(rows[2]?.width01).toBe(0);

    const many = snapshot({
      rows: Array.from({ length: 12 }, (_, index) => ({
        position: index + 1,
        name: `Bot ${String(index + 1)}`,
        value: 12 - index,
        you: false,
      })),
    });
    expect(chartRows(many)).toHaveLength(8);
  });
});

describe("rankSummary", () => {
  it("names scope, leaders, and your rank", () => {
    expect(rankSummary(snapshot())).toBe(
      "Top 3 city impact: Rusty 41.3, Me 20.6, Zed 0.0. You rank #2.",
    );
  });

  it("says plainly when the board is empty", () => {
    expect(rankSummary(snapshot({ rows: [] }))).toBe("No runs on this board yet.");
  });
});
