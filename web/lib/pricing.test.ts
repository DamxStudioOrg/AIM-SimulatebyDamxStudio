import { afterEach, describe, expect, it, vi } from "vitest";
import { estimateCostUsd, formatTokensWithThinking, trueTokenTotal } from "./pricing";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("estimateCostUsd", () => {
  it("prices local runtimes at exactly zero", () => {
    expect(estimateCostUsd(15000, "ollama/llama3.1")).toBe(0);
    expect(estimateCostUsd(15000, "local/hermes3")).toBe(0);
  });

  it("blends the documented gpt-4o-mini rate over total tokens", () => {
    // 70/30 in/out split: 0.7 * 0.15 + 0.3 * 0.60 = 0.285 per 1M.
    expect(estimateCostUsd(1_000_000, "gpt-4o-mini")).toBeCloseTo(0.285, 6);
  });

  it("returns null when no rate is known", () => {
    expect(estimateCostUsd(15000, "baseten/some-org/some-model")).toBeNull();
    expect(estimateCostUsd(15000, "mystery-model")).toBeNull();
  });

  it("lets the operator override rates via env JSON", () => {
    vi.stubEnv(
      "NEXT_PUBLIC_COST_RATES",
      JSON.stringify({ "baseten/some-org/some-model": 1.5 }),
    );
    expect(estimateCostUsd(2_000_000, "baseten/some-org/some-model")).toBeCloseTo(
      3.0,
      6,
    );
  });

  it("ignores malformed env overrides", () => {
    vi.stubEnv("NEXT_PUBLIC_COST_RATES", "not-json");
    expect(estimateCostUsd(1_000_000, "gpt-4o-mini")).toBeCloseTo(0.285, 6);
  });
});

describe("thinking accounting", () => {
  it("totals gameplay plus thinking for true spend", () => {
    expect(trueTokenTotal(7626, 3102)).toBe(10728);
    expect(trueTokenTotal(7626, undefined)).toBe(7626);
    expect(trueTokenTotal(7626, 0)).toBe(7626);
  });

  it("shows the thinking share only when nonzero", () => {
    expect(formatTokensWithThinking(7626, 3102)).toBe("7,626 (+3,102 thinking)");
    expect(formatTokensWithThinking(7626, 0)).toBe("7,626");
    expect(formatTokensWithThinking(7626, undefined)).toBe("7,626");
  });
});
