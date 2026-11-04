import { describe, expect, it } from "vitest";
import type { HistoryEntry } from "./history";
import type { MatchResultPayload, MatchTurn } from "./sim";
import {
  formatDelta,
  ghostSeries,
  raceDeltas,
  raceSeries,
  raceVerdict,
} from "./ghost-race";

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
    intervention: null,
    impact: 40,
    efficiency: 10,
    ...overrides,
  };
}

function result(turns: MatchTurn[]): MatchResultPayload {
  return {
    seed: 7,
    provider: "test",
    scores: { impact: 50, efficiency: 12 },
    totals: {},
    loss_reasons: [],
    turns,
    badges: [],
    strategy: {
      mean_allocation: {},
      policies: {},
      played_turns: turns.length,
      skipped_turns: 0,
    },
    prompt_words: 4,
    token_budget: 15000,
  };
}

describe("raceSeries", () => {
  it("extracts the per-turn running scores", () => {
    expect(
      raceSeries([
        turn({ turn: 1, impact: 40, efficiency: 10 }),
        turn({ turn: 2, impact: 44, efficiency: 11 }),
      ]),
    ).toEqual([
      { turn: 1, impact: 40, efficiency: 10 },
      { turn: 2, impact: 44, efficiency: 11 },
    ]);
  });

  it("refuses series recorded before race timing", () => {
    expect(raceSeries([turn({ impact: undefined })])).toBeNull();
    expect(raceSeries([turn({ efficiency: undefined })])).toBeNull();
  });
});

describe("ghostSeries", () => {
  it("accepts city entries with a full scored series", () => {
    const entry: HistoryEntry = {
      when: "2026-10-30T00:00:00.000Z",
      seed: 7,
      provider: "test",
      prompt: "go",
      game: "city",
      impact: 50,
      efficiency: 12,
      result: result([turn({ turn: 1 }), turn({ turn: 2 })]),
    };
    expect(ghostSeries(entry)).toEqual([
      { turn: 1, impact: 40, efficiency: 10 },
      { turn: 2, impact: 40, efficiency: 10 },
    ]);
  });

  it("refuses tote entries, replays without turns, and legacy series", () => {
    const base: HistoryEntry = {
      when: "2026-10-30T00:00:00.000Z",
      seed: 7,
      provider: "test",
      prompt: "go",
    };
    expect(ghostSeries({ ...base, game: "tote", score: 3 })).toBeNull();
    expect(ghostSeries({ ...base, game: "city", impact: 1 })).toBeNull();
    expect(
      ghostSeries({
        ...base,
        game: "city",
        impact: 1,
        result: result([turn({ turn: 1, impact: undefined })]),
      }),
    ).toBeNull();
  });
});

describe("raceDeltas", () => {
  const ghost = [
    { turn: 1, impact: 40, efficiency: 10 },
    { turn: 2, impact: 44, efficiency: 11 },
  ];

  it("scores live minus ghost per turn", () => {
    const deltas = raceDeltas(
      result([
        turn({ turn: 1, impact: 41, efficiency: 9 }),
        turn({ turn: 2, impact: 44, efficiency: 13 }),
      ]),
      ghost,
    );
    expect(deltas).toEqual([
      { turn: 1, impact: 41, efficiency: 9, impactDelta: 1, efficiencyDelta: -1 },
      { turn: 2, impact: 44, efficiency: 13, impactDelta: 0, efficiencyDelta: 2 },
    ]);
  });

  it("refuses unscored live runs and mismatched lengths", () => {
    expect(
      raceDeltas(result([turn({ turn: 1, impact: undefined })]), ghost),
    ).toBeNull();
    expect(raceDeltas(result([turn({ turn: 1 })]), ghost)).toBeNull();
  });
});

describe("raceVerdict", () => {
  it("reads the final turn deltas", () => {
    expect(
      raceVerdict([
        { turn: 1, impact: 41, efficiency: 9, impactDelta: 1, efficiencyDelta: -1 },
        { turn: 2, impact: 44, efficiency: 13, impactDelta: 0, efficiencyDelta: 2 },
      ]),
    ).toEqual({ impactDelta: 0, efficiencyDelta: 2 });
    expect(raceVerdict([])).toBeNull();
  });
});

describe("formatDelta", () => {
  it("signs deltas to two decimals", () => {
    expect(formatDelta(1.256)).toBe("+1.26");
    expect(formatDelta(-0.4)).toBe("-0.40");
    expect(formatDelta(0)).toBe("+0.00");
  });
});
