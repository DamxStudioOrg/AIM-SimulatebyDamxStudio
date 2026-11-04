import { describe, expect, it } from "vitest";
import {
  turnImpactSeries,
  turnLabel,
  turnTokenSeries,
  versionImpactSeries,
  versionLabel,
} from "./run-charts";
import type { MatchTurn } from "./sim";
import type { HistoryEntry } from "./history";

function turn(overrides: Partial<MatchTurn> = {}): MatchTurn {
  return {
    turn: 1,
    state_hash: "abc",
    skip_reason: null,
    tokens_used: 10,
    usage_anomaly: false,
    spend: 100,
    allocation: null,
    policies: [],
    ...overrides,
  };
}

function entry(overrides: Partial<HistoryEntry> = {}): HistoryEntry {
  return {
    when: "2026-11-01T10:00:00Z",
    game: "city",
    provider: "ollama",
    seed: 7,
    prompt: "rescue first",
    ...overrides,
  };
}

describe("turnLabel", () => {
  it("labels turns T1..Tn, never a month name", () => {
    expect(turnLabel(1)).toBe("T1");
    expect(turnLabel(12)).toBe("T12");
  });
});

describe("turnImpactSeries", () => {
  it("pairs active impact against the compare run by turn number", () => {
    const points = turnImpactSeries(
      [turn({ turn: 1, impact: 0.8 }), turn({ turn: 2, impact: 0.9 })],
      [turn({ turn: 2, impact: 0.5 }), turn({ turn: 1, impact: 0.4 })],
    );
    expect(points).toEqual([
      { label: "T1", current: 0.8, previous: 0.4 },
      { label: "T2", current: 0.9, previous: 0.5 },
    ]);
  });

  it("reads 0 where the compare run lacks the turn", () => {
    const points = turnImpactSeries(
      [turn({ turn: 3, impact: 0.7 })],
      [turn({ turn: 1, impact: 0.2 })],
    );
    expect(points).toEqual([{ label: "T3", current: 0.7, previous: 0 }]);
  });

  it("flatlines at 0 with no compare run", () => {
    const points = turnImpactSeries([turn({ turn: 1, impact: 0.6 })]);
    expect(points).toEqual([{ label: "T1", current: 0.6, previous: 0 }]);
  });

  it("treats missing impact as 0", () => {
    const points = turnImpactSeries([turn({ turn: 1 })]);
    expect(points[0]?.current).toBe(0);
  });

  it("returns no points for no turns", () => {
    expect(turnImpactSeries([])).toEqual([]);
  });
});

describe("turnTokenSeries", () => {
  it("pairs token burn by turn number", () => {
    const points = turnTokenSeries(
      [turn({ turn: 1, tokens_used: 120 })],
      [turn({ turn: 1, tokens_used: 90 })],
    );
    expect(points).toEqual([{ label: "T1", current: 120, previous: 90 }]);
  });

  it("reads 0 for missing compare turns", () => {
    const points = turnTokenSeries([turn({ turn: 2, tokens_used: 50 })]);
    expect(points).toEqual([{ label: "T2", current: 50, previous: 0 }]);
  });
});

describe("versionLabel", () => {
  it("shows MM-DD of the stored run", () => {
    expect(versionLabel("2026-11-01T10:00:00Z")).toBe("11-01");
  });
});

describe("versionImpactSeries", () => {
  it("runs oldest first with each version against the one before", () => {
    const points = versionImpactSeries([
      entry({ when: "2026-11-03T10:00:00Z", impact: 0.9 }),
      entry({ when: "2026-11-02T10:00:00Z", impact: 0.7 }),
      entry({ when: "2026-11-01T10:00:00Z", impact: 0.5 }),
    ]);
    expect(points).toEqual([
      { label: "11-01", current: 0.5, previous: 0 },
      { label: "11-02", current: 0.7, previous: 0.5 },
      { label: "11-03", current: 0.9, previous: 0.7 },
    ]);
  });

  it("skips entries without impact", () => {
    const points = versionImpactSeries([
      entry({ when: "2026-11-02T10:00:00Z", impact: 0.8 }),
      entry({ when: "2026-11-01T10:00:00Z" }),
    ]);
    expect(points).toEqual([{ label: "11-02", current: 0.8, previous: 0 }]);
  });

  it("returns no points when nothing scored", () => {
    expect(versionImpactSeries([entry({})])).toEqual([]);
    expect(versionImpactSeries([])).toEqual([]);
  });
});
