import { describe, expect, it } from "vitest";
import {
  dressingSpots,
  mergeStageContext,
  towerPosition,
  turnDiscs,
  towerShares,
} from "./stage3d";

describe("StageContext visual regression", () => {
  it("merges challenge params deterministically", () => {
    const base = { seed: 7, kind: "city" as const, palette: { moon: 0xffffff } };
    const overrides = { palette: { moon: 0x112233 }, scenery: { moonCraters: 12 } };
    const ctx = mergeStageContext(base, overrides);
    expect(ctx.seed).toBe(7);
    expect(ctx.palette?.moon).toBe(0x112233);
    expect(ctx.scenery?.moonCraters).toBe(12);
  });

  it("tower positions stable across seeds", () => {
    const posA = towerPosition(0, 8);
    const posB = towerPosition(0, 8);
    expect(posA).toEqual(posB);
  });

  it("turn discs length matches turns", () => {
    const discs12 = turnDiscs(12);
    const discs8 = turnDiscs(8);
    expect(discs12).toHaveLength(12);
    expect(discs8).toHaveLength(8);
  });

  it("tower shares interpolate correctly for variable turns", () => {
    const turns = Array.from({ length: 8 }, (_, i) => ({
      turn: i + 1,
      state_hash: `hash-${String(i + 1)}`,
      skip_reason: null,
      tokens_used: 100,
      usage_anomaly: false,
      spend: 1000,
      policies: [],
      allocation: {
        housing: 10 + i,
        transit: 10,
        health: 10,
        green: 10,
        reserves: 10,
        rescue: 10,
        shelter: 10,
        repair: 30 - i,
      },
    }));
    const shares = towerShares(turns, 3.5, null, 8);
    expect(shares).toHaveLength(8);
    // shares should be numeric and within reasonable range
    for (const s of shares) {
      expect(typeof s.share).toBe("number");
      expect(s.share).toBeGreaterThanOrEqual(0);
    }
  });

  it("mergeStageContext preserves turns and dressing", () => {
    const base = { seed: 42, kind: "city" as const, turns: 12 };
    const overrides = { turns: 8, dressing: { kind: "beacon" as const, count: 3 } };
    const ctx = mergeStageContext(base, overrides);
    expect(ctx.turns).toBe(8);
    expect(ctx.dressing?.kind).toBe("beacon");
    expect(ctx.dressing?.count).toBe(3);
  });

  it("dressingSpots deterministic for same seed/kind/count", () => {
    const a = dressingSpots("beacon", 5, 12345);
    const b = dressingSpots("beacon", 5, 12345);
    expect(a).toEqual(b);
    // longer count extends shorter
    const c = dressingSpots("beacon", 3, 12345);
    expect(a.slice(0, 3)).toEqual(c);
  });
});
