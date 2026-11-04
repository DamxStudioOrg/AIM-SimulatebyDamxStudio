import { describe, expect, it } from "vitest";

import { buildTips } from "./prompt-tips";
import type { MatchResultPayload, MatchTurn } from "./sim";

function turn(overrides: Partial<MatchTurn> & { turn: number }): MatchTurn {
  return {
    state_hash: "abc123",
    skip_reason: null,
    tokens_used: 100,
    usage_anomaly: false,
    spend: 10,
    allocation: { housing: 50, health: 30, green: 20 },
    policies: ["shelter-first"],
    impact: 50,
    efficiency: 5,
    ...overrides,
  };
}

function result(overrides?: Partial<MatchResultPayload>): MatchResultPayload {
  return {
    provider: "mock",
    seed: 1,
    turns: Array.from({ length: 12 }, (_, i) => turn({ turn: i + 1 })),
    scores: {
      wellbeing: 70,
      lives: 80,
      infra: 85,
      emissions: 2,
      fiscal: 90,
      impact: 60,
    },
    totals: { tokens_used: 1000, lives_lost: 100, lives_lost_flood: 40, spend: 120 },
    badges: [],
    loss_reasons: [],
    prompt_words: 40,
    token_budget: 2000,
    strategy: { mean_allocation: {}, policies: {}, played_turns: 12, skipped_turns: 0 },
    ...overrides,
  };
}

describe("buildTips", () => {
  it("fills a clean run with static tips", () => {
    const tips = buildTips(result(), { impactSpread: 1 });
    expect(tips).toHaveLength(3);
    expect(tips[0]).toContain("stewardship");
  });

  it("names skipped turns and their reasons first", () => {
    const tips = buildTips(
      result({
        strategy: {
          mean_allocation: {},
          policies: {},
          played_turns: 10,
          skipped_turns: 2,
        },
        turns: [
          ...Array.from({ length: 10 }, (_, i) => turn({ turn: i + 1 })),
          turn({ turn: 11, skip_reason: "turn_token_cap" }),
          turn({ turn: 12, skip_reason: "turn_token_cap" }),
        ],
      }),
      { impactSpread: 1 },
    );
    expect(tips[0]).toContain("2 turns skipped (turn_token_cap)");
  });

  it("quotes lives lost with the flood share", () => {
    const tips = buildTips(
      result({ totals: { tokens_used: 1000, lives_lost: 614, lives_lost_flood: 400 } }),
      { impactSpread: 1 },
    );
    expect(tips[0]).toContain("614 lives lost, 400 to the flood");
  });

  it("flags the turn-5 flood dip by value", () => {
    const turns = Array.from({ length: 12 }, (_, i) =>
      turn({ turn: i + 1, impact: 60 }),
    );
    turns[4] = turn({ turn: 5, impact: 45 });
    const tips = buildTips(result({ turns: turns }), { impactSpread: 1 });
    expect(tips[0]).toContain("turn-5 flood cost 15.00");
  });

  it("flags the turns 9-10 shock dip by value", () => {
    const turns = Array.from({ length: 12 }, (_, i) =>
      turn({ turn: i + 1, impact: 60 }),
    );
    turns[8] = turn({ turn: 9, impact: 48 });
    const tips = buildTips(result({ turns: turns }), { impactSpread: 1 });
    expect(tips[0]).toContain("Turns 9–10 cost 12.00");
  });

  it("flags wide impact spread across runs", () => {
    const tips = buildTips(result(), { impactSpread: 12.5 });
    expect(tips[0]).toContain("Impact swings 12.50 across runs");
  });

  it("names the weakest sub-score as the floor", () => {
    const tips = buildTips(
      result({
        scores: { wellbeing: 40, lives: 80, infra: 85, emissions: 2, fiscal: 90 },
      }),
      { impactSpread: 1 },
    );
    expect(tips[0]).toContain("Wellbeing is your floor at 40.00");
  });

  it("ignores a normal low emissions cut", () => {
    const tips = buildTips(
      result({
        scores: { wellbeing: 70, lives: 80, infra: 85, emissions: 1, fiscal: 90 },
      }),
      { impactSpread: 1 },
    );
    expect(tips.join(" ")).not.toContain("Emissions");
  });

  it("warns when the token budget is nearly spent", () => {
    const tips = buildTips(
      result({ totals: { tokens_used: 1900, lives_lost: 100 }, token_budget: 2000 }),
      { impactSpread: 1 },
    );
    expect(tips.join(" ")).toContain("95% spent");
  });

  it("notes headroom when the budget is barely touched", () => {
    const tips = buildTips(
      result({ totals: { tokens_used: 400, lives_lost: 100 }, token_budget: 2000 }),
      { impactSpread: 1 },
    );
    expect(tips.join(" ")).toContain("Only 20%");
  });

  it("orders by severity and caps at four", () => {
    const turns = Array.from({ length: 12 }, (_, i) =>
      turn({ turn: i + 1, impact: 60 }),
    );
    turns[4] = turn({ turn: 5, impact: 40 });
    turns[8] = turn({ turn: 9, impact: 40 });
    const tips = buildTips(
      result({
        turns: turns,
        scores: { wellbeing: 30, lives: 80, infra: 85, emissions: 2, fiscal: 90 },
        totals: { tokens_used: 1900, lives_lost: 700, lives_lost_flood: 500 },
        token_budget: 2000,
        strategy: {
          mean_allocation: {},
          policies: {},
          played_turns: 11,
          skipped_turns: 1,
        },
      }),
      { impactSpread: 20 },
    );
    expect(tips).toHaveLength(4);
    expect(tips[0]).toContain("skipped");
    expect(tips[1]).toContain("lives lost");
    expect(tips[2]).toContain("turn-5 flood");
    expect(tips[3]).toContain("Turns 9–10");
  });

  it("survives replays missing per-turn impact", () => {
    const turns = Array.from({ length: 12 }, (_, i) =>
      turn({ turn: i + 1, impact: undefined }),
    );
    const tips = buildTips(result({ turns: turns }), { impactSpread: 1 });
    expect(tips.length).toBeGreaterThan(0);
  });
});
