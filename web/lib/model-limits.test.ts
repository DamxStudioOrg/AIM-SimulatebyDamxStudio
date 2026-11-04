import { describe, expect, it } from "vitest";
import { allowanceLabel, effectiveLimits, limitsForModel } from "./model-limits";

describe("allowanceLabel", () => {
  it("compacts words and tokens for picker labels", () => {
    expect(allowanceLabel({ words: 150, tokenBudget: 8000 })).toBe("≤150w · ≤8k");
    expect(allowanceLabel({ words: 300, tokenBudget: 20000 })).toBe("≤300w · ≤20k");
    expect(allowanceLabel({ words: 120, tokenBudget: 6500 })).toBe("≤120w · ≤6.5k");
  });
});

describe("limitsForModel", () => {
  it("gives local runtimes a tighter leash than hosted models", () => {
    expect(limitsForModel("ollama/hermes3:8b", "local")).toEqual({
      words: 150,
      tokenBudget: 8000,
    });
    expect(limitsForModel("meta/llama", "hosted")).toEqual({
      words: 300,
      tokenBudget: 20000,
    });
  });

  it("constrains nothing when the model is unknown or unlisted", () => {
    expect(limitsForModel("", "local")).toBeNull();
    expect(limitsForModel("ollama/x", undefined)).toBeNull();
    expect(limitsForModel("mystery/model", "quantum")).toBeNull();
  });
});

describe("effectiveLimits", () => {
  it("uses the model allowance in open play", () => {
    expect(
      effectiveLimits({
        model: { words: 150, tokenBudget: 8000 },
        contract: { prompt_max_words: 250, token_budget: 15000 },
      }),
    ).toEqual({ words: 150, tokenBudget: 8000 });
  });

  it("falls back to contract defaults without a known model", () => {
    expect(
      effectiveLimits({
        model: null,
        contract: { prompt_max_words: 250, token_budget: 15000 },
      }),
    ).toEqual({ words: 250, tokenBudget: 15000 });
  });

  it("takes the min of challenge and model on a task", () => {
    expect(
      effectiveLimits({
        challenge: { words: 100, tokenBudget: 6500 },
        model: { words: 150, tokenBudget: 20000 },
        contract: { prompt_max_words: 250, token_budget: 15000 },
      }),
    ).toEqual({ words: 100, tokenBudget: 6500 });
    expect(
      effectiveLimits({
        challenge: { words: 250, tokenBudget: 15000 },
        model: { words: 150, tokenBudget: 8000 },
        contract: { prompt_max_words: 250, token_budget: 15000 },
      }),
    ).toEqual({ words: 150, tokenBudget: 8000 });
  });
});
