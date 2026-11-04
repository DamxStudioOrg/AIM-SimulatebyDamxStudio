import { describe, expect, it } from "vitest";
import { turnDelta } from "./turn-delta";
import type { MatchTurn } from "./sim";

function turn(overrides: Partial<MatchTurn> = {}): MatchTurn {
  return {
    turn: 1,
    state_hash: "hash-1",
    skip_reason: null,
    tokens_used: 280,
    usage_anomaly: false,
    spend: 112000,
    allocation: { housing: 12, rescue: 20, reserves: 10 },
    policies: [],
    ...overrides,
  };
}

describe("turnDelta", () => {
  it("names the lead allocation on the first turn", () => {
    expect(turnDelta([turn()], 1)).toBe(
      "Turn 1 of 12 · rescue leads · $112k spend · 280 tokens",
    );
  });

  it("shows the spend swing against the previous turn", () => {
    const turns = [turn(), turn({ turn: 2, spend: 126000, tokens_used: 290 })];
    expect(turnDelta(turns, 2)).toBe(
      "Turn 2 of 12 · rescue leads · $126k spend (+$14k) · 290 tokens",
    );
  });

  it("reports skipped turns with their reason", () => {
    const turns = [turn(), turn({ turn: 2, skip_reason: "invalid_output" })];
    expect(turnDelta(turns, 2)).toBe("Turn 2 of 12 · skipped — invalid_output");
  });

  it("falls back cleanly past the last turn", () => {
    expect(turnDelta([turn()], 12)).toBe(
      "Turn 1 of 12 · rescue leads · $112k spend · 280 tokens",
    );
  });
});
