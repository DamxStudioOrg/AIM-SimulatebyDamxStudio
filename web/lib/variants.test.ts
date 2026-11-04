import { describe, expect, it } from "vitest";
import { bestVariantIndex, buildVariants } from "./variants";
import type { MatchResultPayload } from "./sim";

function result(impact: number): MatchResultPayload {
  return {
    seed: 1,
    provider: "probe",
    scores: { impact, efficiency: 10 },
    totals: { tokens_used: 100, spend: 1000 },
    loss_reasons: [],
    turns: [],
    badges: [],
    strategy: {
      mean_allocation: {},
      policies: {},
      played_turns: 12,
      skipped_turns: 0,
    },
    prompt_words: 10,
    token_budget: 15000,
  };
}

describe("buildVariants", () => {
  it("varies seeds in open play with slider chaos on all three", () => {
    expect(buildVariants({ seed: 7, chaos: 50, challenged: false })).toEqual([
      { label: "Seed 7", seed: 7, chaosLevel: 0.5 },
      { label: "Seed 8", seed: 8, chaosLevel: 0.5 },
      { label: "Seed 9", seed: 9, chaosLevel: 0.5 },
    ]);
  });

  it("omits the chaos key at slider zero", () => {
    const specs = buildVariants({ seed: 7, chaos: 0, challenged: false });
    expect(specs.map((spec) => spec.chaosLevel)).toEqual([
      undefined,
      undefined,
      undefined,
    ]);
  });

  it("varies chaos on the locked seed for armed challenges", () => {
    expect(buildVariants({ seed: 11, chaos: 25, challenged: true })).toEqual([
      { label: "Chaos 0%", seed: 11, chaosLevel: undefined },
      { label: "Chaos 50%", seed: 11, chaosLevel: 0.5 },
      { label: "Chaos 100%", seed: 11, chaosLevel: 1 },
    ]);
  });
});

describe("bestVariantIndex", () => {
  it("picks the highest impact", () => {
    expect(bestVariantIndex([result(40), result(61.5), result(55)])).toBe(1);
  });

  it("breaks ties toward the earliest variant", () => {
    expect(bestVariantIndex([result(50), result(50), result(40)])).toBe(0);
  });
});
