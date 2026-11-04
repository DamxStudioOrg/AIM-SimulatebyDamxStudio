import { describe, expect, it } from "vitest";
import { buildJudgeMessage, parseJudgeVerdict } from "./prompt-judge";
import type { MatchResultPayload } from "./sim";

function result(overrides: Partial<MatchResultPayload> = {}): MatchResultPayload {
  return {
    provider: "ollama/llama3.1",
    seed: 11,
    turns: [
      {
        turn: 1,
        state_hash: "a",
        skip_reason: null,
        tokens_used: 300,
        usage_anomaly: false,
        spend: 10,
        allocation: { housing: 30 },
        policies: [],
        impact: 50,
        efficiency: 5,
      },
      {
        turn: 2,
        state_hash: "b",
        skip_reason: "unparseable",
        tokens_used: 0,
        usage_anomaly: false,
        spend: 0,
        allocation: {},
        policies: [],
        impact: 49,
        efficiency: 5,
      },
    ],
    scores: { impact: 51.234, efficiency: 12.345 },
    totals: { tokens_used: 4000 },
    badges: [],
    loss_reasons: [],
    prompt_words: 40,
    token_budget: 12000,
    strategy: {
      mean_allocation: {},
      policies: {},
      played_turns: 1,
      skipped_turns: 1,
    },
    ...overrides,
  };
}

describe("buildJudgeMessage", () => {
  it("carries the draft and the run facts, skips counted", () => {
    const message = buildJudgeMessage("Fund housing 30%.", result());
    expect(message).toContain("Fund housing 30%.");
    expect(message).toContain("seed 11");
    expect(message).toContain("impact 51.2");
    expect(message).toContain("1 turns played, 1 skipped");
    expect(message).toContain("4000 tokens used of 12000");
  });
});

describe("parseJudgeVerdict", () => {
  it("clamps scores, caps advice, drops junk keys", () => {
    const verdict = parseJudgeVerdict({
      scores: { clarity: 7, specificity: 4.6, contingency: 12, economy: -2 },
      advice: ["Name the split.", "x".repeat(300), 42, ""],
      providerKey: "sk-nope",
    });
    expect(verdict).toEqual({
      scores: { clarity: 7, specificity: 5, contingency: 10, economy: 0 },
      advice: ["Name the split.", "x".repeat(160)],
    });
  });

  it("rejects missing or non-numeric dimensions", () => {
    expect(parseJudgeVerdict(null)).toBeNull();
    expect(parseJudgeVerdict({ scores: { clarity: 5 } })).toBeNull();
    expect(
      parseJudgeVerdict({
        scores: { clarity: "hi", specificity: 1, contingency: 1, economy: 1 },
      }),
    ).toBeNull();
  });
});
