import { describe, expect, it } from "vitest";
import { focusDrill } from "./focus";
import type { MatchResultPayload, MatchTurn } from "./sim";

function turn(overrides: Partial<MatchTurn> & { turn: number }): MatchTurn {
  return {
    state_hash: "abc123",
    skip_reason: null,
    tokens_used: 100,
    usage_anomaly: false,
    spend: 10,
    allocation: { housing: 50, health: 30, green: 20 },
    policies: [],
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
    scores: { impact: 60, efficiency: 10 },
    totals: { tokens_used: 1000 },
    badges: [],
    loss_reasons: [],
    prompt_words: 40,
    token_budget: 2000,
    strategy: {
      mean_allocation: {},
      policies: {},
      played_turns: 12,
      skipped_turns: 0,
    },
  };
}

const FLAT = Array.from({ length: 12 }, (_, i) => turn({ turn: i + 1 }));

describe("focusDrill", () => {
  it("stays quiet on a thin or clean record", () => {
    expect(focusDrill({ prompts: [], results: [] })).toBeNull();
    expect(focusDrill({ prompts: [], results: [result(FLAT)] })).toBeNull();
    expect(
      focusDrill({ prompts: [], results: [result(FLAT), result(FLAT)] }),
    ).toBeNull();
  });

  it("sends repeated skips to the compression drill", () => {
    const skippy = (turnNumber: number): MatchTurn[] =>
      FLAT.map((entry) =>
        entry.turn === turnNumber
          ? turn({ turn: entry.turn, skip_reason: "unparseable", spend: 0 })
          : entry,
      );
    const focus = focusDrill({
      prompts: [],
      results: [result(skippy(3)), result(skippy(4)), result(skippy(5))],
    });
    expect(focus?.drillId).toBe("drill-eighty");
    expect(focus?.title).toBe("Eighty words");
  });

  it("sends unplanned prompts to the two-shocks drill", () => {
    // Numbers and departments are present in these drafts; the
    // recurring gap is any plan for the shock turns.
    const focus = focusDrill({
      prompts: [
        "Put 40% into housing, 30% health and 30% green every turn.",
        "Split 50% housing, 25% health, 25% green across the city.",
        "Allocate 45% housing, 35% health and 20% green per turn.",
      ],
      results: [],
    });
    expect(focus?.drillId).toBe("drill-two-shocks");
  });
});
