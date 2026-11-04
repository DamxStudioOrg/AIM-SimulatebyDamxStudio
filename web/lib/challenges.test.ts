import { describe, expect, it } from "vitest";
import {
  CHALLENGES,
  challengeById,
  challengePassed,
  DRILLS,
  endlessVariant,
  evaluateChallenge,
  goalSummary,
  isChallengeUnlocked,
  isDrillChallenge,
  isEndlessUnlocked,
  isUnifiedUnlocked,
  nextChallenge,
  nextEndlessCycle,
  nextPickAfterClear,
  nextUnifiedPlay,
  parseEndlessId,
  rankWordBonus,
  summarizeProgress,
  summarizeUnified,
  TOTE_CHALLENGES,
  toteNorm100,
  TRIAL_TOKENS_BASE,
  TRIAL_TOKENS_PER_DRIVER,
  TRIAL_WORDS_BASE,
  TRIAL_WORDS_PER_DRIVER,
  unifiedImpact,
  unifiedUnlocked,
  UNIFIED_CHAIN,
  unlockedChallenges,
} from "./challenges";
import type { MatchResultPayload } from "./sim";

function payload(overrides: Partial<MatchResultPayload> = {}): MatchResultPayload {
  return {
    seed: 11,
    provider: "ollama:llama3.1",
    scores: { impact: 58.3, efficiency: 14.4 },
    totals: {
      tokens_used: 3346,
      spend: 1263873,
      lives_lost_heatwave: 300,
    },
    loss_reasons: [],
    turns: [],
    badges: [],
    strategy: {
      mean_allocation: {},
      policies: {},
      played_turns: 0,
      skipped_turns: 0,
    },
    prompt_words: 12,
    token_budget: 15000,
    ...overrides,
  };
}

describe("challenge evaluation", () => {
  it("passes impact above the bar", () => {
    const floodWall = CHALLENGES.find((c) => c.id === "flood-wall");
    expect(floodWall).toBeDefined();
    if (floodWall === undefined) {
      return;
    }
    const checks = evaluateChallenge(floodWall, payload({ seed: 11 }));
    expect(challengePassed(checks)).toBe(true);
  });

  it("fails impact below the bar", () => {
    const floodWall = CHALLENGES.find((c) => c.id === "flood-wall");
    expect(floodWall).toBeDefined();
    if (floodWall === undefined) {
      return;
    }
    const checks = evaluateChallenge(
      floodWall,
      payload({ scores: { impact: 52.85, efficiency: 14.0 } }),
    );
    expect(challengePassed(checks)).toBe(false);
    expect(checks[0]?.passed).toBe(false);
  });

  it("fails heat deaths above the bar", () => {
    const heat = CHALLENGES.find((c) => c.id === "southside-heatwave");
    expect(heat).toBeDefined();
    if (heat === undefined) {
      return;
    }
    const checks = evaluateChallenge(
      heat,
      payload({
        totals: { tokens_used: 3346, spend: 1263873, lives_lost_heatwave: 445 },
      }),
    );
    expect(challengePassed(checks)).toBe(false);
  });

  it("requires both skinflint goals at once", () => {
    const skinflint = CHALLENGES.find((c) => c.id === "skinflint");
    expect(skinflint).toBeDefined();
    if (skinflint === undefined) {
      return;
    }
    const rich = evaluateChallenge(
      skinflint,
      payload({ scores: { impact: 45.9, efficiency: 15.3 } }),
    );
    expect(challengePassed(rich)).toBe(false);
    const lean = evaluateChallenge(
      skinflint,
      payload({
        scores: { impact: 45.9, efficiency: 15.3 },
        totals: { tokens_used: 3000, spend: 890836, lives_lost_heatwave: 0 },
      }),
    );
    expect(challengePassed(lean)).toBe(true);
  });

  it("treats a finished match as a debut", () => {
    const debut = CHALLENGES.find((c) => c.id === "debut");
    expect(debut).toBeDefined();
    if (debut === undefined) {
      return;
    }
    expect(challengePassed(evaluateChallenge(debut, payload()))).toBe(true);
  });

  it("never passes on zero checks", () => {
    expect(challengePassed([])).toBe(false);
  });

  it("summarizes every challenge", () => {
    for (const challenge of CHALLENGES) {
      const summary = goalSummary(challenge);
      expect(summary).toContain(`Seed ${String(challenge.seed)}`);
    }
  });

  it("keeps nine challenges with stable ids", () => {
    expect(CHALLENGES.map((c) => c.id)).toEqual([
      "debut",
      "flood-wall",
      "southside-heatwave",
      "pound-for-pound",
      "skinflint",
      "worst-street",
      "fifth-alarm",
      "tenth-bell",
      "westside-audit",
    ]);
  });

  it("fails fifth-alarm at baseline heat deaths, passes at sharp heat deaths", () => {
    const challenge = CHALLENGES.find((c) => c.id === "fifth-alarm");
    expect(challenge).toBeDefined();
    if (challenge === undefined) {
      return;
    }
    const baseline = payload({
      seed: 5,
      totals: { tokens_used: 3346, spend: 1263339, lives_lost_heatwave: 1113 },
    });
    expect(challengePassed(evaluateChallenge(challenge, baseline))).toBe(false);
    const sharp = payload({
      seed: 5,
      totals: { tokens_used: 3346, spend: 1337680, lives_lost_heatwave: 1036 },
    });
    expect(challengePassed(evaluateChallenge(challenge, sharp))).toBe(true);
  });

  it("fails tenth-bell at baseline heat deaths, passes at sharp heat deaths", () => {
    const challenge = CHALLENGES.find((c) => c.id === "tenth-bell");
    expect(challenge).toBeDefined();
    if (challenge === undefined) {
      return;
    }
    const baseline = payload({
      seed: 10,
      totals: { tokens_used: 3346, spend: 1263502, lives_lost_heatwave: 958 },
    });
    expect(challengePassed(evaluateChallenge(challenge, baseline))).toBe(false);
    const sharp = payload({
      seed: 10,
      totals: { tokens_used: 3346, spend: 1337842, lives_lost_heatwave: 892 },
    });
    expect(challengePassed(evaluateChallenge(challenge, sharp))).toBe(true);
  });

  it("fails westside-audit at baseline efficiency, passes at sharp efficiency", () => {
    const challenge = CHALLENGES.find((c) => c.id === "westside-audit");
    expect(challenge).toBeDefined();
    if (challenge === undefined) {
      return;
    }
    const baseline = payload({
      seed: 11,
      scores: { impact: 52.85, efficiency: 14.09 },
    });
    expect(challengePassed(evaluateChallenge(challenge, baseline))).toBe(false);
    const sharp = payload({
      seed: 11,
      scores: { impact: 58.11, efficiency: 14.9 },
    });
    expect(challengePassed(evaluateChallenge(challenge, sharp))).toBe(true);
  });

  it("fails pound-for-pound at baseline efficiency, passes at sharp efficiency", () => {
    const challenge = CHALLENGES.find((c) => c.id === "pound-for-pound");
    expect(challenge).toBeDefined();
    if (challenge === undefined) {
      return;
    }
    const baseline = payload({
      seed: 9,
      scores: { impact: 52.4, efficiency: 13.97 },
    });
    expect(challengePassed(evaluateChallenge(challenge, baseline))).toBe(false);
    const sharp = payload({
      seed: 9,
      scores: { impact: 57.41, efficiency: 14.72 },
    });
    expect(challengePassed(evaluateChallenge(challenge, sharp))).toBe(true);
  });

  it("derives word and token limits from declared drivers", () => {
    for (const challenge of [...CHALLENGES, ...TOTE_CHALLENGES]) {
      expect(challenge.drivers.length).toBeGreaterThan(0);
      expect(challenge.words).toBe(
        TRIAL_WORDS_BASE + TRIAL_WORDS_PER_DRIVER * challenge.drivers.length,
      );
      expect(challenge.tokenBudget).toBe(
        TRIAL_TOKENS_BASE + TRIAL_TOKENS_PER_DRIVER * challenge.drivers.length,
      );
      // Budgets stay above measured scripted usage (~3.3k/match) so the
      // calibrated bars stand: limits shape LLM runs, never the bars.
      expect(challenge.tokenBudget).toBeGreaterThanOrEqual(6000);
    }
    // Same drivers, same budget: the pressure comes from the trial.
    const debut = challengeById("debut");
    expect(debut?.words).toBe(TRIAL_WORDS_BASE + TRIAL_WORDS_PER_DRIVER);
  });

  it("points southside-heatwave at a seed with a real heatwave", () => {
    const heat = CHALLENGES.find((c) => c.id === "southside-heatwave");
    expect(heat).toBeDefined();
    if (heat === undefined) {
      return;
    }
    expect(heat.seed).toBe(8);
    const baseline = payload({
      seed: 8,
      totals: { tokens_used: 3346, spend: 1260378, lives_lost_heatwave: 239 },
    });
    expect(challengePassed(evaluateChallenge(heat, baseline))).toBe(false);
    const sharp = payload({
      seed: 8,
      totals: { tokens_used: 3346, spend: 1334493, lives_lost_heatwave: 190 },
    });
    expect(challengePassed(evaluateChallenge(heat, sharp))).toBe(true);
  });
});

describe("unlock chain", () => {
  const [first, second, third] = CHALLENGES.map((entry) => entry.id);

  it("opens the first challenge and hides the rest until cleared", () => {
    expect(isChallengeUnlocked(first ?? "", [])).toBe(true);
    expect(isChallengeUnlocked(second ?? "", [])).toBe(false);
    expect(isChallengeUnlocked("nope", [])).toBe(false);
    expect(unlockedChallenges([]).map((entry) => entry.id)).toEqual([first]);
  });

  it("unlocks each challenge behind the previous clearance", () => {
    expect(isChallengeUnlocked(second ?? "", [first ?? ""])).toBe(true);
    expect(isChallengeUnlocked(third ?? "", [first ?? ""])).toBe(false);
    expect(
      unlockedChallenges([first ?? "", second ?? ""]).map((entry) => entry.id),
    ).toEqual([first, second, third]);
  });
});

describe("tote challenges", () => {
  it("stay out of the city-only chain and are always findable", async () => {
    const { TOTE_CHALLENGES, challengeById, CHALLENGES } = await import("./challenges");
    expect(TOTE_CHALLENGES.length).toBeGreaterThanOrEqual(2);
    for (const entry of TOTE_CHALLENGES) {
      expect(entry.kind).toBe("tote");
      expect(CHALLENGES.some((city) => city.id === entry.id)).toBe(false);
      expect(challengeById(entry.id)?.title).toBe(entry.title);
    }
    expect(challengeById("debut")?.kind).toBe("city");
    expect(challengeById("nope")).toBeUndefined();
  });

  it("scores a pack against its bar", async () => {
    const { TOTE_CHALLENGES, evaluateToteChallenge } = await import("./challenges");
    const task = TOTE_CHALLENGES[0];
    if (task === undefined) throw new Error("tote challenge missing");
    const pack = { score: (task.goals.minPackScore ?? 0) + 1 };
    const checks = evaluateToteChallenge(task, pack);
    expect(checks).toHaveLength(1);
    expect(checks[0]?.passed).toBe(true);
    const weak = evaluateToteChallenge(task, { score: 0 });
    expect(weak[0]?.passed).toBe(false);
  });
});

describe("rankWordBonus", () => {
  it("grants a few words to the top three, nothing below", () => {
    expect(rankWordBonus(1)).toBe(15);
    expect(rankWordBonus(2)).toBe(10);
    expect(rankWordBonus(3)).toBe(5);
    expect(rankWordBonus(4)).toBe(0);
    expect(rankWordBonus(null)).toBe(0);
  });
});

describe("challenge stories", () => {
  it("gives every challenge at least two non-empty beats", () => {
    expect(CHALLENGES.length).toBe(9);
    for (const entry of CHALLENGES) {
      expect(entry.story.length).toBeGreaterThanOrEqual(2);
      for (const beat of entry.story) {
        expect(beat.trim().length).toBeGreaterThan(0);
      }
    }
  });
});

describe("challenge progression", () => {
  const ids = (count: number): string[] =>
    CHALLENGES.slice(0, count).map((entry) => entry.id);

  it("starts at the first challenge", () => {
    expect(nextChallenge([])?.id).toBe(CHALLENGES[0]?.id);
  });

  it("advances past cleared challenges", () => {
    expect(nextChallenge(ids(1))?.id).toBe(CHALLENGES[1]?.id);
  });

  it("stays on a locked gap instead of skipping it", () => {
    // Second cleared out of order: the first is still next.
    expect(nextChallenge(ids(2).slice(1))?.id).toBe(CHALLENGES[0]?.id);
  });

  it("ends after the last challenge", () => {
    expect(nextChallenge(CHALLENGES.map((entry) => entry.id))).toBeUndefined();
  });

  it("summarizes empty, partial, and full progress", () => {
    expect(summarizeProgress({})).toEqual({
      cleared: 0,
      total: CHALLENGES.length,
      endless: 0,
      tote: 0,
      bestImpact: null,
      bestEfficiency: null,
    });
    const [first, second] = ids(2);
    expect(first).toBeDefined();
    expect(second).toBeDefined();
    expect(
      summarizeProgress({
        [String(first)]: {
          when: "2026-10-31",
          impact: 41.5,
          efficiency: 12,
          model: "m",
        },
        [String(second)]: {
          when: "2026-10-31",
          impact: 58.3,
          efficiency: 9.5,
          model: "m",
        },
      }),
    ).toEqual({
      cleared: 2,
      total: CHALLENGES.length,
      endless: 0,
      tote: 0,
      bestImpact: 58.3,
      bestEfficiency: 12,
    });
  });

  it("counts endless cycles past the chain, ignoring unknown bases", () => {
    const base = CHALLENGES[1];
    if (base === undefined) throw new Error("expected a second challenge");
    const done = (impact: number) => ({
      when: "2026-11-02",
      impact,
      efficiency: 0,
      model: "m",
    });
    expect(
      summarizeProgress({
        [base.id]: done(57),
        [`${base.id}~endless1`]: done(58),
        [`${base.id}~endless2`]: done(59),
        "not-a-challenge~endless1": done(999),
      }),
    ).toEqual({
      cleared: 1,
      total: CHALLENGES.length,
      endless: 2,
      tote: 0,
      bestImpact: 57,
      bestEfficiency: 0,
    });
  });

  it("counts cleared tote drop-ins beside the chain", () => {
    const done = (impact: number) => ({
      when: "2026-11-02",
      impact,
      efficiency: 0,
      model: "m",
    });
    expect(
      summarizeProgress({
        debut: done(50),
        "market-day": done(32),
      }),
    ).toEqual({
      cleared: 1,
      total: CHALLENGES.length,
      endless: 0,
      tote: 1,
      bestImpact: 50,
      bestEfficiency: 0,
    });
  });

  it("endless variants reseed a cleared challenge and resolve by id", () => {
    const base = CHALLENGES[0];
    if (base === undefined) throw new Error("expected a first challenge");
    const variant = endlessVariant(base, 2);
    expect(variant.seed).not.toBe(base.seed);
    expect(variant.goals).toEqual(base.goals);
    expect(parseEndlessId(variant.id)).toEqual({ baseId: base.id, cycle: 2 });
    expect(parseEndlessId(base.id)).toBeNull();
    expect(challengeById(variant.id)?.seed).toBe(variant.seed);
    expect(isEndlessUnlocked(variant.id, [base.id])).toBe(true);
    expect(isEndlessUnlocked(variant.id, [])).toBe(false);
  });

  it("keeps base bars for the first endless replay, then ratchets", () => {
    const wall = CHALLENGES.find((entry) => entry.id === "flood-wall");
    const thrifty = CHALLENGES.find((entry) => entry.id === "skinflint");
    if (wall === undefined || thrifty === undefined) {
      throw new Error("expected flood-wall and skinflint trials");
    }
    expect(endlessVariant(wall, 1).goals).toEqual(wall.goals);
    expect(endlessVariant(wall, 2).goals.minImpact).toBe(57.7);
    expect(endlessVariant(wall, 3).goals.minImpact).toBe(59.4);
    const skinny = endlessVariant(thrifty, 2).goals;
    expect(skinny.minImpact).toBe(41.2);
    expect(skinny.maxSpend).toBe(1018500);
    // Finish-the-match trials stay finish-only at every cycle.
    const debut = CHALLENGES[0];
    if (debut === undefined) throw new Error("expected a first challenge");
    expect(endlessVariant(debut, 5).goals).toEqual(debut.goals);
  });

  it("counts endless cycles per base for replay offers", () => {
    const base = CHALLENGES[0];
    if (base === undefined) throw new Error("expected a first challenge");
    const done = (impact: number) => ({
      when: "",
      impact,
      efficiency: 0,
      model: "m",
    });
    expect(nextEndlessCycle(base.id, { [base.id]: done(50) })).toBe(1);
    expect(
      nextEndlessCycle(base.id, {
        [base.id]: done(50),
        [`${base.id}~endless1`]: done(51),
        [`${base.id}~endless2`]: done(52),
        "flood-wall~endless9": done(1),
      }),
    ).toBe(3);
  });

  it("ignores completions for unknown ids in bests", () => {
    expect(
      summarizeProgress({
        "not-a-challenge": { when: "", impact: 999, efficiency: 999, model: "" },
      }),
    ).toEqual({
      cleared: 0,
      total: CHALLENGES.length,
      endless: 0,
      tote: 0,
      bestImpact: null,
      bestEfficiency: null,
    });
  });
});

describe("unified game", () => {
  const done = (impact: number) => ({
    when: "2026-11-02",
    impact,
    efficiency: 0,
    model: "m",
  });

  it("alternates city and tote down the whole chain", () => {
    expect(UNIFIED_CHAIN.length).toBe(CHALLENGES.length * 2);
    UNIFIED_CHAIN.forEach((entry, index) => {
      expect(entry.kind).toBe(index % 2 === 0 ? "city" : "tote");
    });
  });

  it("unlocks strictly in alternating order", () => {
    const [city0, tote0, city1] = UNIFIED_CHAIN.map((entry) => entry.id);
    expect(isUnifiedUnlocked(city0 ?? "", [])).toBe(true);
    expect(isUnifiedUnlocked(tote0 ?? "", [])).toBe(false);
    expect(isUnifiedUnlocked(city1 ?? "", [city0 ?? ""])).toBe(false);
    expect(isUnifiedUnlocked(city1 ?? "", [city0 ?? "", tote0 ?? ""])).toBe(true);
    expect(isUnifiedUnlocked("nope", [])).toBe(false);
    expect(unifiedUnlocked([]).map((entry) => entry.id)).toEqual([city0]);
  });

  it("offers the first uncleared trial, gaps included", () => {
    expect(nextUnifiedPlay({})?.id).toBe(UNIFIED_CHAIN[0]?.id);
    const [city0, tote0, city1, tote1] = UNIFIED_CHAIN.map((entry) => entry.id);
    // Skipping the packing shift does not skip it: the gap plays next.
    expect(
      nextUnifiedPlay({
        [city0 ?? ""]: done(50),
        [city1 ?? ""]: done(50),
      })?.id,
    ).toBe(tote0);
    expect(
      nextUnifiedPlay({
        [city0 ?? ""]: done(50),
        [tote0 ?? ""]: done(80),
        [city1 ?? ""]: done(50),
      })?.id,
    ).toBe(tote1);
  });

  it("continues alternating past the chain, city first", () => {
    const cleared: Record<string, ReturnType<typeof done>> = {};
    for (const entry of UNIFIED_CHAIN) {
      cleared[entry.id] = done(60);
    }
    const first = nextUnifiedPlay(cleared);
    expect(first?.kind).toBe("city");
    expect(first?.id).toBe(`${CHALLENGES[0]?.id ?? "debut"}~endless1`);
    if (first === undefined) {
      return;
    }
    cleared[first.id] = done(60);
    const second = nextUnifiedPlay(cleared);
    expect(second?.kind).toBe("tote");
    // The chain already replayed market-day through cycle 4.
    expect(second?.id).toBe("market-day~endless5");
  });

  it("advances to the next play on a first clear", () => {
    const [city0, tote0] = UNIFIED_CHAIN.map((entry) => entry.id);
    expect(nextPickAfterClear({ [city0 ?? ""]: done(50) }, [], city0 ?? "")).toBe(
      tote0,
    );
  });

  it("stays put on re-clears, open play, and foreign keys", () => {
    const [city0, tote0] = UNIFIED_CHAIN.map((entry) => entry.id);
    const cleared = { [city0 ?? ""]: done(50) };
    // Same keys, better score: a retry, not a first clear.
    expect(nextPickAfterClear(cleared, [city0 ?? ""], city0 ?? "")).toBeNull();
    // Nothing selected: open play never advances.
    expect(nextPickAfterClear(cleared, [], "")).toBeNull();
    // Another task cleared elsewhere: not this form's business.
    expect(nextPickAfterClear(cleared, [], tote0 ?? "")).toBeNull();
  });

  it("advances into the endless tail past the chain", () => {
    const cleared: Record<string, ReturnType<typeof done>> = {};
    for (const entry of UNIFIED_CHAIN) {
      cleared[entry.id] = done(60);
    }
    const last = UNIFIED_CHAIN[UNIFIED_CHAIN.length - 1]?.id ?? "";
    const prev = Object.keys(cleared).filter((id) => id !== last);
    const next = nextPickAfterClear(cleared, prev, last);
    expect(next).toBe(`${CHALLENGES[0]?.id ?? "debut"}~endless1`);
  });
});

describe("unified scoring", () => {
  it("normalizes tote packs against par", () => {
    expect(toteNorm100(45)).toBe(100);
    expect(toteNorm100(22.5)).toBe(50);
    expect(toteNorm100(0)).toBe(0);
    expect(toteNorm100(60)).toBe(100);
    expect(toteNorm100(-5)).toBe(0);
    expect(toteNorm100(Number.NaN)).toBe(0);
  });

  it("reads stamped clears directly and normalizes legacy tote clears", () => {
    expect(
      unifiedImpact("market-day", {
        when: "",
        impact: 80,
        efficiency: 0,
        model: "",
        kind: "tote",
        raw: 36,
      }),
    ).toBe(80);
    expect(
      unifiedImpact("market-day", { when: "", impact: 36, efficiency: 0, model: "" }),
    ).toBe(80);
    expect(
      unifiedImpact("debut", { when: "", impact: 58, efficiency: 0, model: "" }),
    ).toBe(58);
  });

  it("summarizes the unified run with legacy-aware bests", () => {
    expect(summarizeUnified({})).toEqual({
      cleared: 0,
      total: UNIFIED_CHAIN.length,
      endless: 0,
      bestUnified: null,
    });
    expect(
      summarizeUnified({
        debut: { when: "", impact: 58, efficiency: 0, model: "" },
        "market-day": { when: "", impact: 45, efficiency: 0, model: "" },
        "flood-wall~endless1": { when: "", impact: 60, efficiency: 0, model: "" },
      }),
    ).toEqual({
      cleared: 2,
      total: UNIFIED_CHAIN.length,
      endless: 1,
      bestUnified: 100,
    });
  });
});

describe("tote endless", () => {
  it("resolves tote endless variants by id", async () => {
    const { TOTE_CHALLENGES } = await import("./challenges");
    const base = TOTE_CHALLENGES[0];
    expect(base).toBeDefined();
    if (base === undefined) {
      return;
    }
    const variant = challengeById(`${base.id}~endless1`);
    expect(variant?.kind).toBe("tote");
    expect(variant?.seed).toBe(base.seed + 7919);
    expect(variant?.goals.minPackScore).toBe(base.goals.minPackScore);
    expect(challengeById("nope~endless1")).toBeUndefined();
  });

  it("counts tote endless cycles in progress", () => {
    const done = (impact: number) => ({
      when: "2026-11-02",
      impact,
      efficiency: 0,
      model: "m",
    });
    expect(
      summarizeProgress({
        "market-day~endless1": done(80),
        "market-day~endless2": done(82),
      }).endless,
    ).toBe(2);
  });
});

describe("prompting drills", () => {
  it("stays outside the ranked chain, always open", () => {
    expect(DRILLS.length).toBe(5);
    expect(new Set(DRILLS.map((entry) => entry.id)).size).toBe(DRILLS.length);
    for (const drill of DRILLS) {
      expect(drill.kind).toBe("city");
      expect(isDrillChallenge(drill.id)).toBe(true);
      expect(challengeById(drill.id)?.title).toBe(drill.title);
      expect(UNIFIED_CHAIN.some((entry) => entry.id === drill.id)).toBe(false);
      expect(isUnifiedUnlocked(drill.id, [])).toBe(false);
    }
    expect(isDrillChallenge("debut")).toBe(false);
  });

  it("hands the fix drill its flawed draft and caps the compression drill", () => {
    const fix = challengeById("drill-fix");
    expect(fix?.starterPrompt).toContain("Spend everything on housing");
    const eighty = challengeById("drill-eighty");
    expect(eighty?.words).toBe(80);
    // Bars sit between the fixed baseline and the sharp reference.
    expect(fix?.goals.minImpact).toBeGreaterThan(52.85);
    expect(fix?.goals.minImpact).toBeLessThan(58.11);
  });
});
