import { describe, expect, it } from "vitest";
import type { MatchTurn } from "./sim";
import {
  allocationAt,
  costLoad,
  EVEN_SPLIT,
  mulberry32,
  spentThrough,
  spendVec,
  totalTokens,
} from "./city-scene";

function turn(over: Partial<MatchTurn> = {}): MatchTurn {
  return {
    turn: 1,
    state_hash: "h",
    skip_reason: null,
    tokens_used: 100,
    usage_anomaly: false,
    spend: 105000,
    allocation: { ...EVEN_SPLIT },
    policies: [],
    ...over,
  };
}

describe("allocationAt", () => {
  it("returns the latest allocation at or before the turn", () => {
    const first = { ...EVEN_SPLIT, housing: 50 };
    const turns = [
      turn({ turn: 1, allocation: first }),
      turn({ turn: 2, allocation: null }),
    ];
    expect(allocationAt(turns, 2)).toBe(first);
    expect(allocationAt(turns, 5)).toBe(first);
  });

  it("falls back to an even split when nothing is known", () => {
    expect(allocationAt([], 1)).toBe(EVEN_SPLIT);
    expect(allocationAt([turn({ allocation: null })], 1)).toBe(EVEN_SPLIT);
  });
});

describe("spendVec", () => {
  it("scales shares by spend in $3.5k units", () => {
    const vec = spendVec(turn());
    expect(vec).toHaveLength(8);
    expect(vec.reduce((a, b) => a + b, 0)).toBeCloseTo(105000 / 3500, 6);
    expect(vec[0]).toBeCloseTo(0.125 * 30, 6);
  });

  it("is all zeros without a turn", () => {
    expect(spendVec(undefined)).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
  });
});

describe("token and cost helpers", () => {
  it("totals tokens and spend through done turns", () => {
    const turns = [turn(), turn({ turn: 2, tokens_used: 50, spend: 5000 })];
    expect(totalTokens(turns)).toBe(150);
    expect(spentThrough(turns, 1)).toEqual({ tokens: 100, dollars: 105000 });
    expect(spentThrough(turns, 9)).toEqual({ tokens: 150, dollars: 110000 });
  });

  it("grows cost load with dollars and tokens", () => {
    expect(costLoad(0, 0)).toBe(1);
    expect(costLoad(500000, 15000)).toBe(3);
  });
});

describe("mulberry32", () => {
  it("replays the same stream per seed", () => {
    const a = mulberry32(7);
    const b = mulberry32(7);
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
    expect(mulberry32(8)()).not.toBe(mulberry32(7)());
  });
});
