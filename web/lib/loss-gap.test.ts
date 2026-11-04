import { describe, expect, it } from "vitest";
import { allocationGaps, bestSeedReference, gapLines } from "./loss-gap";
import type { HistoryEntry } from "./history";
import type { MatchResultPayload } from "./sim";

function result(mean: Record<string, number>): MatchResultPayload {
  return {
    seed: 7,
    provider: "test",
    scores: { impact: 10, efficiency: 1 },
    totals: {},
    loss_reasons: [],
    turns: [],
    badges: [],
    strategy: {
      mean_allocation: mean,
      policies: {},
      played_turns: 12,
      skipped_turns: 0,
    },
    prompt_words: 3,
    token_budget: 15000,
  };
}

describe("allocationGaps", () => {
  it("ranks underfunded keys biggest first and ignores small deltas", () => {
    const mine = result({ rescue: 5, housing: 20, health: 10 });
    const best = result({ rescue: 20, housing: 22, health: 10 });
    expect(allocationGaps(mine, best)).toEqual([{ key: "rescue", delta: 15 }]);
    expect(gapLines(mine, best)).toEqual([
      "rescue underfunded by 15 points vs your best run on this seed",
    ]);
  });

  it("is empty when this run matches or beats the reference", () => {
    const mine = result({ rescue: 20 });
    expect(allocationGaps(mine, result({ rescue: 10 }))).toEqual([]);
  });

  it("picks the best better city run on the same seed as reference", () => {
    const mine = result({ rescue: 5 });
    const better = result({ rescue: 25 });
    better.scores.impact = 40;
    const entries: HistoryEntry[] = [
      { when: "t1", seed: 7, provider: "p", prompt: "", impact: 40, result: better },
      { when: "t2", seed: 8, provider: "p", prompt: "", impact: 99, result: better },
    ];
    expect(bestSeedReference(entries, mine)).toBe(better);
    mine.scores.impact = 50;
    expect(bestSeedReference(entries, mine)).toBeNull();
  });
});
