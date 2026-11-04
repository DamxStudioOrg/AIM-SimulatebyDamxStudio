import { describe, expect, it } from "vitest";
import type { HistoryEntry } from "./history";
import {
  ELO_START,
  createLeague,
  decodeShareCode,
  duelFromEntry,
  encodeShareCode,
  entryStanding,
  expectedScore,
  ghostFromDuel,
  inSeason,
  loadGhosts,
  loadLeagues,
  loadRatings,
  loadTrials,
  localTrialChallenge,
  mergeLeague,
  parseRotationId,
  ratingFor,
  resolveDuels,
  rotationChallenge,
  seasonFor,
  snapshotFromProposal,
  standingsFor,
  trialChallenge,
  updateElo,
  upsertTrial,
} from "./leagues";
import type { DuelShare, Ghost, League, TrialSnapshot } from "./leagues";

const UID_A = "11111111-2222-4333-8444-555555555555";
const UID_B = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";

function must<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) {
    throw new Error("expected a value");
  }
  return value;
}

function cityEntry(overrides: Partial<HistoryEntry> = {}): HistoryEntry {
  return {
    when: "2026-10-27T00:00:00.000Z",
    seed: 11,
    provider: "ollama:llama3.1",
    impact: 58.11,
    efficiency: 14.9,
    prompt: "hold reserves, rescue hard",
    uid: UID_A,
    ...overrides,
  };
}

describe("share codes", () => {
  it("round-trips a duel target without a prompt by default", () => {
    const duel = duelFromEntry(cityEntry(), { nickname: "Rex" });
    expect(duel).not.toBeNull();
    if (duel === null) {
      return;
    }
    expect(duel.prompt).toBeUndefined();
    expect(duel.metric).toBe("impact");
    expect(duel.value).toBe(58.11);
    const code = encodeShareCode(duel);
    expect(code.startsWith("AIM1.")).toBe(true);
    expect(decodeShareCode(code)).toEqual(duel);
    expect(code).not.toContain("hold reserves");
  });

  it("includes the prompt only when the owner opts in", () => {
    const duel = duelFromEntry(cityEntry(), {
      nickname: null,
      includePrompt: true,
    });
    expect(duel?.prompt).toBe("hold reserves, rescue hard");
    expect(decodeShareCode(encodeShareCode(must(duel)))).toEqual(duel);
  });

  it("scores tote duels on pack score", () => {
    const duel = duelFromEntry(
      cityEntry({ game: "tote", score: 41.04, impact: undefined }),
      { nickname: null },
    );
    expect(duel?.metric).toBe("score");
    expect(duel?.value).toBe(41.04);
  });

  it("rejects malformed, versioned-wrong, and key-bearing codes", () => {
    expect(decodeShareCode("hello")).toBeNull();
    expect(decodeShareCode("AIM1.%%%")).toBeNull();
    const duel = must(duelFromEntry(cityEntry(), { nickname: null }));
    const tampered = {
      ...duel,
      version: 2 as unknown as 1,
    };
    expect(decodeShareCode(encodeShareCode(tampered))).toBeNull();
    const keyed = encodeShareCode({
      ...duel,
      providerKey: "sk-secret",
    } as unknown as DuelShare);
    const decoded = decodeShareCode(keyed);
    expect(decoded === null || !("providerKey" in decoded)).toBe(true);
    expect(JSON.stringify(decoded)).not.toContain("sk-secret");
  });

  it("round-trips a league invite", () => {
    const league = createLeague(
      "Riverside crew",
      UID_A,
      "Rex",
      "2026-10-29T00:00:00.000Z",
      "ab12",
    );
    expect(league).not.toBeNull();
    const code = encodeShareCode({
      version: 1,
      kind: "league",
      league: must(league),
    });
    expect(decodeShareCode(code)).toEqual({
      version: 1,
      kind: "league",
      league,
    });
  });
});

describe("leagues", () => {
  it("creates a league with the creator as first member", () => {
    const league = createLeague(
      "  Riverside crew  ",
      UID_A,
      "Rex",
      "2026-10-29T00:00:00.000Z",
      "ab12",
    );
    expect(league?.name).toBe("Riverside crew");
    expect(league?.id).toBe("riverside-crew-ab12");
    expect(league?.members).toEqual([{ uid: UID_A, nickname: "Rex" }]);
    expect(
      createLeague("   ", UID_A, null, "2026-10-29T00:00:00.000Z", "ab12"),
    ).toBeNull();
  });

  it("merges an invite once, unioning members and joining the importer", () => {
    const mine = must(
      createLeague("Riverside crew", UID_A, "Rex", "2026-10-29T00:00:00.000Z", "ab12"),
    );
    const invited: League = {
      ...mine,
      members: [
        { uid: UID_A, nickname: "Rex" },
        { uid: UID_B, nickname: "Ada" },
      ],
    };
    const merged = mergeLeague([mine], invited, { uid: UID_B, nickname: "Ada" });
    expect(merged).toHaveLength(1);
    expect(merged[0]?.members.map((member) => member.uid)).toEqual([UID_A, UID_B]);
    const again = mergeLeague(merged, invited, { uid: UID_B, nickname: "Ada" });
    expect(again[0]?.members).toHaveLength(2);
  });

  it("loads stored leagues tolerantly", () => {
    expect(loadLeagues(null)).toEqual([]);
    expect(loadLeagues("nope")).toEqual([]);
    const league = must(
      createLeague("Crew", UID_A, null, "2026-10-29T00:00:00.000Z", "zz99"),
    );
    expect(loadLeagues(JSON.stringify([league, { bogus: true }]))).toEqual([league]);
  });
});

describe("standings", () => {
  it("ranks members by best value, earliest best first on ties", () => {
    const rows = standingsFor(
      [
        { uid: UID_A, nickname: "Rex", value: 50, when: "2026-10-27T00:00:00.000Z" },
        { uid: UID_B, nickname: "Ada", value: 55, when: "2026-10-28T00:00:00.000Z" },
        { uid: UID_A, nickname: "Rex", value: 55, when: "2026-10-26T00:00:00.000Z" },
        { uid: UID_A, nickname: "Rex", value: 40, when: "2026-10-29T00:00:00.000Z" },
      ],
      [UID_A, UID_B],
    );
    expect(rows.map((row) => row.uid)).toEqual([UID_A, UID_B]);
    expect(rows[0]).toMatchObject({ best: 55, plays: 3 });
  });

  it("maps history entries and ghosts to standing rows", () => {
    expect(entryStanding(cityEntry(), UID_A, "Rex")?.value).toBe(58.11);
    const ghost = ghostFromDuel(
      must(duelFromEntry(cityEntry({ uid: UID_B }), { nickname: "Ada" })),
      "2026-10-29T00:00:00.000Z",
    );
    expect(ghost.outcome).toBe("pending");
    expect(ghost.uid).toBe(UID_B);
  });
});

describe("seasons", () => {
  it("keeps fixed 14-day UTC windows from the anchor", () => {
    const first = seasonFor(new Date("2026-01-05T12:00:00.000Z"));
    expect(first.index).toBe(0);
    expect(first.startsAt).toBe("2026-01-05T00:00:00.000Z");
    expect(first.endsAt).toBe("2026-01-19T00:00:00.000Z");
    expect(seasonFor(new Date("2026-01-19T00:00:00.000Z")).index).toBe(1);
    expect(inSeason("2026-01-18T23:59:59.000Z", first)).toBe(true);
    expect(inSeason("2026-01-19T00:00:00.000Z", first)).toBe(false);
  });
});

describe("elo", () => {
  it("expects a coin flip between equals and moves 12 points on a win", () => {
    expect(expectedScore(1200, 1200)).toBe(0.5);
    expect(updateElo(1200, 1200)).toEqual({ winner: 1212, loser: 1188 });
    expect(ratingFor({}, UID_A)).toBe(ELO_START);
  });

  it("settles a duel once and leaves ratings alone on a rematch scan", () => {
    const ghost: Ghost = ghostFromDuel(
      must(duelFromEntry(cityEntry({ uid: UID_B, impact: 50 }), { nickname: "Ada" })),
      "2026-10-29T00:00:00.000Z",
    );
    const history = [cityEntry({ impact: 58.11 })];
    const first = resolveDuels(history, [ghost], {}, UID_A);
    expect(first.settled).toHaveLength(1);
    expect(first.ghosts[0]?.outcome).toBe("won");
    expect(first.ratings[UID_A]).toBe(1212);
    expect(first.ratings[UID_B]).toBe(1188);
    const second = resolveDuels(history, first.ghosts, first.ratings, UID_A);
    expect(second.settled).toHaveLength(0);
    expect(second.ratings).toEqual(first.ratings);
  });

  it("records a loss when the ghost target stands", () => {
    const ghost = ghostFromDuel(
      must(duelFromEntry(cityEntry({ uid: UID_B, impact: 70 }), { nickname: "Ada" })),
      "2026-10-29T00:00:00.000Z",
    );
    const result = resolveDuels([cityEntry({ impact: 58.11 })], [ghost], {}, UID_A);
    expect(result.ghosts[0]?.outcome).toBe("lost");
    expect(result.ratings[UID_A]).toBe(1188);
  });

  it("loads ghosts and ratings tolerantly", () => {
    expect(loadGhosts("nope")).toEqual([]);
    expect(loadRatings("nope")).toEqual({});
    expect(loadRatings(JSON.stringify({ [UID_A]: 1250, bad: "x" }))).toEqual({
      [UID_A]: 1250,
    });
  });
});

describe("creator rotation", () => {
  it("derives a deterministic playable trial per proposal", () => {
    const trial = rotationChallenge({
      id: 7,
      title: "Beat the night bus",
      description: "Keep the night routes alive.",
    });
    expect(trial.id).toBe("rotation-7");
    expect(trial.seed).toBe(
      rotationChallenge({ id: 7, title: "x", description: "y" }).seed,
    );
    expect(trial.goals).toEqual({ minImpact: 0 });
    expect(trial.words).toBeGreaterThan(0);
    expect(trial.tokenBudget).toBeGreaterThanOrEqual(6000);
    expect(parseRotationId(trial.id)).toBe(7);
    expect(parseRotationId("flood-wall")).toBeNull();
    const others = new Set(
      [1, 2, 3, 4, 5].map(
        (id) => rotationChallenge({ id, title: "t", description: "d" }).seed,
      ),
    );
    expect(others.size).toBeGreaterThan(1);
  });

  it("carries valid dressing and ignores anything else", () => {
    const assets = {
      version: 1,
      palette: { moon: "moon", crater: "crater", accent: "brand", crane: "gold" },
      scenery: { trees: 12, clouds: 4, beacons: 6, pennants: 10, shrooms: 5 },
      moon: { craters: 14, size: 1.0 },
      towers: { heightScale: 1.0 },
    };
    const dressed = rotationChallenge({
      id: 7,
      title: "t",
      description: "d",
      assets,
    });
    // v1 dressing upgrades on attach: same look, v2 shape, quiet defaults.
    expect(dressed.assets).toEqual({
      ...assets,
      version: 2,
      scenery: { ...assets.scenery, lanterns: 0 },
      moon: { ...assets.moon, halo: 0 },
      towers: { ...assets.towers, widthScale: 1 },
    });
    const bare = rotationChallenge({ id: 7, title: "t", description: "d" });
    expect(bare.assets).toBeNull();
    expect(dressed.seed).toBe(bare.seed);
    expect(dressed.goals).toEqual(bare.goals);
    const smuggled = rotationChallenge({
      id: 7,
      title: "t",
      description: "d",
      assets: { ...assets, gameplay: { shocks: 9 } },
    });
    expect(smuggled.assets).toBeNull();
  });

  it("plays an unproposed draft under the reserved local id", () => {
    const draft = localTrialChallenge({
      title: "  Ember finals ",
      description: "Survive the frost parade.",
    });
    const rotation = rotationChallenge({ id: 7, title: "t", description: "d" });
    expect(draft.kind).toBe("city");
    expect(draft.id).toBe("rotation-0");
    expect(parseRotationId(draft.id)).toBe(0);
    expect(draft.title).toBe("Ember finals");
    expect(draft.brief).toBe("Survive the frost parade.");
    expect(draft.goals).toEqual({ minImpact: 0 });
    expect(draft.words).toBe(rotation.words);
    expect(draft.tokenBudget).toBe(rotation.tokenBudget);
    expect(Number.isInteger(draft.seed)).toBe(true);
    expect(draft.assets).toBeNull();
  });

  it("falls back to the trimmed title when the draft is blank", () => {
    const draft = localTrialChallenge({ title: "  ", description: "" });
    expect(draft.title).toBe("Local draft");
    expect(draft.brief).toBe("Local draft");
  });

  it("carries draft dressing and drops anything invalid", () => {
    const assets = {
      version: 1,
      palette: { moon: "moon", crater: "crater", accent: "brand", crane: "gold" },
      scenery: { trees: 12, clouds: 4, beacons: 6, pennants: 10, shrooms: 5 },
      moon: { craters: 14, size: 1.0 },
      towers: { heightScale: 1.0 },
    };
    const dressed = localTrialChallenge({
      title: "t",
      description: "d",
      assets,
    });
    expect(dressed.assets?.palette.crane).toBe("gold");
    const bare = localTrialChallenge({ title: "t", description: "d" });
    expect(bare.assets).toBeNull();
    expect(dressed.seed).toBe(bare.seed);
    expect(dressed.goals).toEqual(bare.goals);
    const smuggled = localTrialChallenge({
      title: "t",
      description: "d",
      assets: { bogus: true },
    });
    expect(smuggled.assets).toBeNull();
  });
});

describe("trial codes", () => {
  const proposal = {
    id: 42,
    uid: UID_A,
    nickname: "rook",
    title: "Ember watch",
    description: "Hold the ridge through ember season.",
    model: "ollama/hermes3:8b",
    input_prompt: "Allocate the ridge budget.",
    output_format: "JSON allocations per turn",
    restrictions: null,
  };

  it("round-trips a trial code and rebuilds the playable challenge", () => {
    const snapshot = snapshotFromProposal(proposal);
    const code = encodeShareCode({
      version: 1,
      kind: "trial",
      trial: snapshot,
    });
    const decoded = decodeShareCode(code);
    expect(decoded).toMatchObject({ version: 1, kind: "trial" });
    if (decoded?.kind !== "trial") {
      throw new Error("expected a trial payload");
    }
    expect(decoded.trial).toEqual(snapshot);
    const challenge = trialChallenge(decoded.trial);
    expect(challenge.id).toBe("rotation-42");
    expect(challenge.title).toBe("Ember watch");
    expect(challenge.seed).toBe(
      rotationChallenge({ id: 42, title: "x", description: "y" }).seed,
    );
  });

  it("rejects oversized, bad-owner, and key-bearing trial codes", () => {
    const base = snapshotFromProposal(proposal);
    const oversized: TrialSnapshot = { ...base, title: "x".repeat(81) };
    expect(
      decodeShareCode(encodeShareCode({ version: 1, kind: "trial", trial: oversized })),
    ).toBeNull();
    const badOwner: TrialSnapshot = { ...base, ownerUid: "not-a-uid" };
    expect(
      decodeShareCode(encodeShareCode({ version: 1, kind: "trial", trial: badOwner })),
    ).toBeNull();
    const keyed = { ...base, providerKey: "sk-live" } as TrialSnapshot;
    const cleaned = decodeShareCode(
      encodeShareCode({ version: 1, kind: "trial", trial: keyed }),
    );
    if (cleaned?.kind !== "trial") {
      throw new Error("expected a trial payload");
    }
    expect("providerKey" in cleaned.trial).toBe(false);
  });

  it("stores trials deduped by proposal id, newest first", () => {
    const first = snapshotFromProposal(proposal);
    const second = snapshotFromProposal({ ...proposal, id: 43, title: "Second" });
    const stored = upsertTrial(upsertTrial([], first), second);
    expect(stored.map((entry) => entry.proposalId)).toEqual([43, 42]);
    const refreshed = upsertTrial(stored, { ...first, title: "Renamed" });
    expect(refreshed.map((entry) => entry.proposalId)).toEqual([42, 43]);
    expect(refreshed[0]?.title).toBe("Renamed");
    expect(loadTrials(JSON.stringify(refreshed))).toEqual(refreshed);
    expect(loadTrials("[42, null]")).toEqual([]);
    expect(loadTrials("not json")).toEqual([]);
  });
});
