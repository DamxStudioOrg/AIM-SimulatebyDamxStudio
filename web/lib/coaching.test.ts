import { describe, expect, it } from "vitest";

import { buildCoaching } from "./coaching";
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

function result(turns: MatchTurn[]): MatchResultPayload {
  return {
    provider: "mock",
    seed: 1,
    turns,
    scores: { impact: 60 },
    totals: { tokens_used: 1000 },
    badges: [],
    loss_reasons: [],
    prompt_words: 40,
    token_budget: 2000,
    strategy: { mean_allocation: {}, policies: {}, played_turns: 12, skipped_turns: 0 },
  };
}

const FLAT = Array.from({ length: 12 }, (_, i) => turn({ turn: i + 1 }));

describe("buildCoaching signals", () => {
  it("counts skips, shock dips, idle turns, and concentration", () => {
    const turns = FLAT.map((entry) => ({ ...entry }));
    turns[2] = turn({ turn: 3, skip_reason: "unparseable", spend: 0, impact: 50 });
    turns[4] = turn({ turn: 5, impact: 41 }); // -9 at the turn-5 shock
    turns[5] = turn({ turn: 6, impact: 41, spend: 0 });
    const coaching = buildCoaching(result(turns));
    expect(coaching.signals.skipped).toBe(1);
    expect(coaching.signals.shockDips).toBe(1);
    expect(coaching.signals.idle).toBeGreaterThanOrEqual(1);
    expect(coaching.signals.concentrated).toBe(false);
  });

  it("flags a one-department budget as concentrated", () => {
    const turns = FLAT.map((entry) =>
      turn({ turn: entry.turn, allocation: { housing: 90, health: 10 } }),
    );
    expect(buildCoaching(result(turns)).signals.concentrated).toBe(true);
  });
});

describe("buildCoaching", () => {
  it("returns no tips for a clean flat run", () => {
    const coaching = buildCoaching(result(FLAT));
    expect(coaching.tips).toHaveLength(0);
    expect(coaching.flagTurns).toHaveLength(0);
  });

  it("names skipped turns and their reasons first", () => {
    const turns = [...FLAT];
    turns[6] = turn({ turn: 7, skip_reason: "turn_token_cap" });
    turns[7] = turn({ turn: 8, skip_reason: "turn_token_cap" });
    const coaching = buildCoaching(result(turns));
    expect(coaching.tips[0]).toContain("2 turns never ran (turn_token_cap)");
  });

  it("flags the worst impact drop by turn and value", () => {
    const turns = Array.from({ length: 12 }, (_, i) =>
      turn({ turn: i + 1, impact: 60 }),
    );
    turns[4] = turn({ turn: 5, impact: 45 });
    const coaching = buildCoaching(result(turns));
    expect(coaching.tips[0]).toContain("Turn 5 lost 15.00 impact");
    expect(coaching.flagTurns).toEqual([5]);
  });

  it("calls out idle spend", () => {
    const turns = [...FLAT];
    turns[2] = turn({ turn: 3, spend: 0 });
    const coaching = buildCoaching(result(turns));
    expect(coaching.tips.join(" ")).toContain("1 turn spent nothing");
  });

  it("calls out lopsided allocation", () => {
    const turns = Array.from({ length: 12 }, (_, i) =>
      turn({ turn: i + 1, allocation: { housing: 90, health: 10 } }),
    );
    const coaching = buildCoaching(result(turns));
    expect(coaching.tips.join(" ")).toContain("90% of every budget went to housing");
  });

  it("orders by severity and caps at four", () => {
    const turns = Array.from({ length: 12 }, (_, i) =>
      turn({ turn: i + 1, impact: 60, allocation: { housing: 90, health: 10 } }),
    );
    turns[4] = turn({ turn: 5, impact: 40, allocation: { housing: 90, health: 10 } });
    turns[6] = turn({
      turn: 7,
      skip_reason: "turn_token_cap",
      allocation: { housing: 90, health: 10 },
    });
    turns[2] = turn({ turn: 3, spend: 0, allocation: { housing: 90, health: 10 } });
    const coaching = buildCoaching(result(turns));
    expect(coaching.tips).toHaveLength(4);
    expect(coaching.tips[0]).toContain("never ran");
    expect(coaching.tips[1]).toContain("lost 20.00");
  });

  it("survives turns missing impact", () => {
    const turns = Array.from({ length: 12 }, (_, i) =>
      turn({ turn: i + 1, impact: undefined }),
    );
    const coaching = buildCoaching(result(turns));
    expect(coaching.tips).toHaveLength(0);
  });
});
