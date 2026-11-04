import { afterEach, describe, expect, it, vi } from "vitest";
import {
  formatHistoryWhen,
  loadHistory,
  mergeHistories,
  storeHistory,
} from "./history";
import type { HistoryEntry } from "./history";
import type { MatchResultPayload, TotePackResult } from "./sim";

function entry(overrides: Partial<HistoryEntry> = {}): HistoryEntry {
  return {
    when: "2026-10-27T00:00:00.000Z",
    seed: 1,
    provider: "ollama:llama3.1",
    impact: 50,
    efficiency: 13,
    prompt: "hold reserves",
    ...overrides,
  };
}

function payload(): MatchResultPayload {
  return {
    seed: 1,
    provider: "ollama:llama3.1",
    scores: { impact: 50, efficiency: 13 },
    totals: { tokens_used: 100 },
    loss_reasons: [],
    turns: [],
    badges: [],
    strategy: { mean_allocation: {}, policies: {}, played_turns: 0, skipped_turns: 0 },
    prompt_words: 2,
    token_budget: 6000,
  };
}

function toteEntry(overrides: Partial<HistoryEntry> = {}): HistoryEntry {
  return {
    when: "2026-10-27T00:00:00.000Z",
    seed: 1,
    provider: "ollama:llama3.1",
    game: "tote",
    score: 8.5,
    damage: 1.2,
    packed: 6,
    prompt: "pack the saw last",
    ...overrides,
  };
}

function totePayload(): TotePackResult {
  return {
    seed: 1,
    provider: "ollama:llama3.1",
    uid: "arena-1",
    offered: ["saw", "rope"],
    packing: ["rope", "saw"],
    value: 9.7,
    damage: { overweight: 0, crush: 1.2, stain: 0, cut: 0, total: 1.2 },
    score: 8.5,
    totals: { tokens_used: 40 },
    invalid_reason: null,
    scarce: [],
    wildcards: [],
    badges: [],
    bonus: 0,
    usage_anomaly: false,
  };
}

describe("mergeHistories", () => {
  it("merges without duplicating the same run", () => {
    const mine = [entry()];
    const incoming = [entry(), entry({ when: "2026-10-27T00:00:01.000Z" })];
    expect(mergeHistories(mine, incoming)).toHaveLength(2);
  });

  it("sorts newest first and caps at twenty", () => {
    const many = Array.from({ length: 25 }, (_, index) =>
      entry({ when: `2026-10-27T00:00:${String(index).padStart(2, "0")}Z` }),
    );
    const merged = mergeHistories([], many);
    expect(merged).toHaveLength(20);
    expect(merged[0]?.when).toBe("2026-10-27T00:00:24Z");
  });

  it("drops malformed incoming entries", () => {
    const merged = mergeHistories(
      [],
      [entry(), { bogus: true } as unknown as HistoryEntry],
    );
    expect(merged).toHaveLength(1);
  });

  it("drops a malformed replay but keeps the summary", () => {
    const merged = mergeHistories(
      [],
      [entry({ result: { bogus: true } as unknown as MatchResultPayload })],
    );
    expect(merged).toHaveLength(1);
    expect(merged[0]?.result).toBeUndefined();
    expect(merged[0]?.impact).toBe(50);
  });

  it("keeps a match and a pack recorded in the same moment", () => {
    const merged = mergeHistories([], [entry(), toteEntry()]);
    expect(merged).toHaveLength(2);
  });

  it("drops tote entries without a score", () => {
    const scoreless = toteEntry();
    delete scoreless.score;
    const merged = mergeHistories([], [toteEntry(), scoreless]);
    expect(merged).toHaveLength(1);
    expect(merged[0]?.prompt).toBe("pack the saw last");
  });
});

describe("loadHistory", () => {
  it("keeps a well-formed replay payload", () => {
    const loaded = loadHistory(JSON.stringify([entry({ result: payload() })]));
    expect(loaded).toHaveLength(1);
    expect(loaded[0]?.result?.seed).toBe(1);
  });

  it("drops a malformed replay payload but keeps the summary", () => {
    const loaded = loadHistory(
      JSON.stringify([
        entry({ result: { bogus: true } as unknown as MatchResultPayload }),
      ]),
    );
    expect(loaded).toHaveLength(1);
    expect(loaded[0]?.result).toBeUndefined();
  });

  it("defaults legacy entries without a game to city", () => {
    const loaded = loadHistory(JSON.stringify([entry()]));
    expect(loaded).toHaveLength(1);
    expect(loaded[0]?.game).toBe("city");
  });

  it("keeps tote packs with a score and drops packs without one", () => {
    const scoreless = toteEntry();
    delete scoreless.score;
    const loaded = loadHistory(JSON.stringify([toteEntry(), scoreless]));
    expect(loaded).toHaveLength(1);
    expect(loaded[0]?.game).toBe("tote");
    expect(loaded[0]?.score).toBe(8.5);
  });

  it("keeps a well-formed tote replay payload", () => {
    const loaded = loadHistory(JSON.stringify([toteEntry({ result: totePayload() })]));
    expect(loaded).toHaveLength(1);
    expect(loaded[0]?.result).toMatchObject({ packing: ["rope", "saw"] });
  });

  it("drops a mismatched replay but keeps the pack summary", () => {
    const loaded = loadHistory(JSON.stringify([toteEntry({ result: payload() })]));
    expect(loaded).toHaveLength(1);
    expect(loaded[0]?.result).toBeUndefined();
    expect(loaded[0]?.score).toBe(8.5);
  });
});

describe("formatHistoryWhen", () => {
  it("formats a valid timestamp", () => {
    expect(formatHistoryWhen("2026-10-27T00:00:00.000Z")).toContain("2026");
  });

  it("falls back to the raw value when invalid", () => {
    expect(formatHistoryWhen("not-a-date")).toBe("not-a-date");
  });
});

describe("storeHistory", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("persists entries with replays", () => {
    const saved: Record<string, string> = {};
    vi.stubGlobal("window", {
      localStorage: {
        setItem: (key: string, value: string) => {
          saved[key] = value;
        },
      },
    });
    storeHistory([entry({ result: payload() })]);
    expect(saved["aim-arena-history"] ?? "").toContain('"turns":[]');
  });

  it("retries summaries-only when the store is full", () => {
    const saved: Record<string, string> = {};
    let calls = 0;
    vi.stubGlobal("window", {
      localStorage: {
        setItem: (key: string, value: string) => {
          calls += 1;
          if (value.includes('"turns"')) {
            throw new Error("quota exceeded");
          }
          saved[key] = value;
        },
      },
    });
    storeHistory([entry({ result: payload() })]);
    expect(calls).toBe(2);
    expect(saved["aim-arena-history"] ?? "").toContain("hold reserves");
    expect(saved["aim-arena-history"] ?? "").not.toContain('"turns"');
  });
});
