import { describe, expect, it } from "vitest";
import type { MatchTurn } from "./sim";
import { CITY_KEYS } from "./city-scene";
import {
  TOWER_COLORS,
  COMPANION,
  CRANE_X,
  MOON_REF_PX,
  MOON_RADIUS,
  TOWER_ARC_R,
  companionAngle,
  cranePose,
  crateSize,
  dressingSpots,
  companionFactor,
  companionStep,
  rankBars,
  restorationAmount,
  shockKind,
  skyline,
  terrainFeatures,
  topKeysByTotal,
  toteCrates,
  towerPosition,
  towerShares,
  turnDiscs,
  groveSpots,
  hutSpot,
  vegetationMood,
  mergeStageContext,
  cactusCutoff,
} from "./stage3d";
import { STAGE } from "./stage.tokens";
import type { EnvironmentReport } from "./sim";

function turn(allocation: Record<string, number>, spend = 105000): MatchTurn {
  return {
    turn: 1,
    state_hash: "x",
    skip_reason: null,
    tokens_used: 100,
    usage_anomaly: false,
    spend,
    allocation,
    policies: [],
  };
}

const EVEN = {
  housing: 12.5,
  transit: 12.5,
  health: 12.5,
  green: 12.5,
  reserves: 12.5,
  rescue: 12.5,
  shelter: 12.5,
  repair: 12.5,
};

describe("goofy palette", () => {
  it("paints every budget key a different candy color", () => {
    const colors = CITY_KEYS.map((key) => TOWER_COLORS[key]);
    expect(new Set(colors).size).toBe(CITY_KEYS.length);
  });
});

describe("towerShares", () => {
  it("gives eight towers, taller where the share is bigger", () => {
    const towers = towerShares([turn({ ...EVEN, housing: 40, rescue: 2 })], 0, null);
    expect(towers).toHaveLength(8);
    const housing = towers.find((tower) => tower.key === "housing");
    const rescue = towers.find((tower) => tower.key === "rescue");
    expect(housing?.share).toBe(40);
    expect((housing?.height ?? 0) > (rescue?.height ?? 0)).toBe(true);
  });

  it("interpolates between turns and freezes on a selected turn", () => {
    const turns = [turn(EVEN), turn({ ...EVEN, housing: 40, rescue: 2 })];
    const mid = towerShares(turns, 0.5, null).find((t) => t.key === "housing");
    expect(mid?.share).toBeCloseTo(26.25);
    const frozen = towerShares(turns, 0.5, 1).find((t) => t.key === "housing");
    expect(frozen?.share).toBe(12.5);
  });

  it("falls back to an even split without turns", () => {
    for (const tower of towerShares([], 0, null)) {
      expect(tower.share).toBeCloseTo(12.5);
    }
  });
});

describe("shockKind", () => {
  it("follows the replay shock windows", () => {
    expect(shockKind(3.9, null)).toBeNull();
    expect(shockKind(4.2, null)).toBe("flood");
    expect(shockKind(8.4, null)).toBe("heat");
    expect(shockKind(10.6, null)).toBeNull();
    expect(shockKind(0, 6)).toBe("flood");
    expect(shockKind(0, 10)).toBe("heat");
    expect(shockKind(0, 3)).toBeNull();
  });
});

describe("moon-companion link", () => {
  it("holds scale at the reference viewport width", () => {
    expect(companionFactor(MOON_REF_PX)).toBe(1);
    expect(companionFactor(0)).toBe(1);
  });

  it("shrinks the companion as the moon grows", () => {
    expect(companionFactor(MOON_REF_PX * 2)).toBeCloseTo(0.5, 5);
    expect(companionFactor(MOON_REF_PX * 4)).toBe(0.38);
  });

  it("grows the companion as the moon shrinks, capped", () => {
    expect(companionFactor(MOON_REF_PX / 2)).toBe(1.45);
  });

  it("eases toward the target and snaps under reduced motion", () => {
    const stepped = companionStep(1, 0.6, false);
    expect(stepped).toBeLessThan(1);
    expect(stepped).toBeGreaterThan(0.6);
    expect(companionStep(1, 0.6, true)).toBe(0.6);
    let current = 1;
    for (let i = 0; i < 200; i += 1) {
      current = companionStep(current, 0.6, false);
    }
    expect(current).toBeCloseTo(0.6, 4);
  });
});

describe("scene layout", () => {
  it("lays out twelve turn discs in order", () => {
    const discs = turnDiscs();
    expect(discs.map((disc) => disc.turn)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12,
    ]);
    expect((discs[0]?.x ?? 0) < (discs[11]?.x ?? 0)).toBe(true);
  });

  it("replays the same skyline per seed", () => {
    expect(skyline(7)).toEqual(skyline(7));
    expect(skyline(7)).not.toEqual(skyline(8));
    expect(skyline(7).length).toBeGreaterThan(8);
    for (const box of skyline(7)) {
      expect(box.h).toBeGreaterThan(0);
    }
  });

  it("fits every skyline box fully on the moon disc", () => {
    for (let seed = 1; seed <= 40; seed += 1) {
      for (const box of skyline(seed)) {
        expect(Math.hypot(box.x, box.z) + box.w / 2).toBeLessThanOrEqual(MOON_RADIUS);
      }
    }
  });

  it("ranks budget keys by match totals, ties stable", () => {
    const heavy = Object.fromEntries(CITY_KEYS.map((key) => [key, 5]));
    heavy.rescue = 60;
    const light = Object.fromEntries(CITY_KEYS.map((key) => [key, 5]));
    light.housing = 60;
    const turns = [turn(heavy), turn(light), turn(light)];
    expect(topKeysByTotal(turns, 2)).toEqual(["housing", "rescue"]);
    expect(topKeysByTotal(turns, 0)).toEqual([]);
    // All tied: CITY_KEYS order, first three.
    const flat = Object.fromEntries(
      CITY_KEYS.map((key) => [key, 100 / CITY_KEYS.length]),
    );
    const tied = [turn(flat), turn(flat)];
    expect(topKeysByTotal(tied, 3)).toEqual(CITY_KEYS.slice(0, 3));
  });

  it("stands towers and discs on the moon disc", () => {
    const towers = [0, 1, 2, 3, 4, 5, 6, 7].map((i) => towerPosition(i, 8));
    for (const spot of towers) {
      expect(Math.hypot(spot.x, spot.z + 4.6)).toBeCloseTo(TOWER_ARC_R, 5);
    }
    expect((towers[0]?.x ?? 0) < (towers[7]?.x ?? 0)).toBe(true);
    const discs = turnDiscs();
    for (const disc of discs) {
      expect(Math.hypot(disc.x, disc.z + 4.6)).toBeLessThanOrEqual(MOON_RADIUS);
    }
  });
});

describe("toteCrates", () => {
  const weights = new Map([
    ["rope", 1],
    ["saw", 4],
  ]);

  it("lands crates bottom-to-top in packing order", () => {
    const crates = toteCrates(["rope", "saw"], weights, 100000);
    expect(crates.map((crate) => crate.id)).toEqual(["rope", "saw"]);
    expect(crates[0]?.landed).toBe(true);
    expect((crates[1]?.stackY ?? 0) > (crates[0]?.stackY ?? 0)).toBe(true);
    expect(crateSize(4)).toBeGreaterThan(crateSize(1));
  });

  it("starts landed-free before the first item flies", () => {
    const crates = toteCrates(["rope"], weights, 0);
    expect(crates[0]?.landed).toBe(false);
    expect(crates[0]?.progress).toBe(0);
  });
});

describe("rankBars", () => {
  it("scales bar heights from the chart share", () => {
    const bars = rankBars([
      { position: 1, name: "Rex", value: 50, width01: 1, you: false },
      { position: 2, name: "Ada", value: 25, width01: 0.5, you: true },
    ]);
    expect(bars).toHaveLength(2);
    expect((bars[0]?.height ?? 0) > (bars[1]?.height ?? 0)).toBe(true);
    expect(bars[0]?.leader).toBe(true);
    expect(bars[1]?.you).toBe(true);
  });
});

function environmentReport(): EnvironmentReport {
  const cell = (
    site: string,
    index: number,
    feature: "rock" | "vent" | "flora" | "barren",
  ) => ({
    site,
    index,
    soil: "loam",
    slope: 30,
    moisture: 50,
    fertility: 50,
    heat: 30,
    erosion: 20,
    feature,
  });
  return {
    sites: {
      quarry: [cell("quarry", 0, "rock"), cell("quarry", 1, "barren")],
      aquifer: [cell("aquifer", 0, "flora")],
      vent: [cell("vent", 0, "vent")],
    },
    site_health: { quarry: 90, aquifer: 95, vent: 80 },
    summary: { moisture: 50, fertility: 50, heat: 40, erosion: 20 },
    features: { rock: 1, vent: 1, flora: 1, barren: 1 },
    stewardship_bias: 4,
    restoration: {
      weather: "rain",
      turns: [6, 7, 8],
      magnitude: 9,
      replay_seconds: 18,
    },
    prioritization: 55,
    trace: [],
  };
}

describe("restorationAmount", () => {
  it("is zero outside the restoration window and peaks inside it", () => {
    expect(restorationAmount(2, [6, 7, 8])).toBe(0);
    expect(restorationAmount(9, [6, 7, 8])).toBe(0);
    expect(restorationAmount(6.5, [6, 7, 8])).toBe(1);
    expect(restorationAmount(5.2, [6, 7, 8])).toBeGreaterThan(0);
    expect(restorationAmount(5.2, [6, 7, 8])).toBeLessThan(1);
    expect(restorationAmount(0, [])).toBe(0);
  });
});

describe("terrainFeatures", () => {
  it("lays sites out left to right and keeps barren cells empty", () => {
    const features = terrainFeatures(environmentReport());
    expect(features.map((feature) => feature.kind)).toEqual(["rock", "flora", "vent"]);
    const quarry = features.find((feature) => feature.site === "quarry");
    const vent = features.find((feature) => feature.site === "vent");
    expect((quarry?.x ?? 0) < (vent?.x ?? 0)).toBe(true);
    expect(terrainFeatures(undefined)).toEqual([]);
  });
});

describe("cactusCutoff", () => {
  it("sits below the sim flora slope ceiling so steep flora can reach it", () => {
    // The sim only grows flora where slope < FLORA_MAX_SLOPE (45 in
    // app/sim/src/aim_sim/terraform.py). A cutoff at or above that
    // ceiling makes terrain cacti unreachable dead code.
    expect(STAGE.VEGETATION.CACTUS_SLOPE).toBeLessThan(45);
  });

  it("maps the token through the same slope scale as the features", () => {
    expect(cactusCutoff()).toBeCloseTo(
      0.45 + (STAGE.VEGETATION.CACTUS_SLOPE / 100) * 0.55,
      10,
    );
  });
});

describe("bigMoon", () => {
  it("sits east of the crane and turns slowly, frozen under reduced motion", () => {
    expect(COMPANION.x).toBeGreaterThan(CRANE_X);
    expect(COMPANION.radius).toBeGreaterThan(5);
    expect(companionAngle(0, true)).toBe(companionAngle(99999, true));
    const turned = companionAngle(90000, false) - companionAngle(0, false);
    expect(turned).toBeCloseTo(Math.PI * 2, 5);
  });
});

describe("cranePose", () => {
  it("hooks the tote at the centre of its drift and releases it at the ends", () => {
    const centred = cranePose(0, false);
    expect(centred.hooked).toBe(true);
    expect(centred.toteLift).toBeGreaterThan(0.5);
    const end = cranePose(8168, false);
    expect(end.hooked).toBe(false);
    expect(end.toteLift).toBeLessThan(0.1);
    expect(end.toteX).toBeGreaterThan(centred.toteX);
    const frozen = cranePose(12345, true);
    expect(frozen.toteY).toBe(cranePose(999, true).toteY);
    expect(centred.cableLength).toBeGreaterThan(1);
  });
});

describe("dressingSpots", () => {
  it("lays counts on the festival ring inside the disc", () => {
    const spots = dressingSpots("beacon", 12, 21);
    expect(spots).toHaveLength(12);
    for (const spot of spots) {
      const radius = Math.hypot(spot.x, spot.z);
      expect(radius).toBeGreaterThanOrEqual(9);
      expect(radius).toBeLessThanOrEqual(13.5);
      expect(spot.s).toBeGreaterThanOrEqual(0.8);
      expect(spot.s).toBeLessThanOrEqual(1.3);
    }
  });

  it("is deterministic and prefix-stable per kind", () => {
    expect(dressingSpots("shroom", 5, 21)).toEqual(dressingSpots("shroom", 5, 21));
    expect(dressingSpots("shroom", 5, 21)).toEqual(
      dressingSpots("shroom", 8, 21).slice(0, 5),
    );
    expect(dressingSpots("shroom", 5, 21)).not.toEqual(dressingSpots("pennant", 5, 21));
    expect(dressingSpots("shroom", 5, 21)).not.toEqual(dressingSpots("shroom", 5, 22));
  });

  it("lays nothing for empty counts", () => {
    expect(dressingSpots("beacon", 0, 21)).toEqual([]);
    expect(dressingSpots("beacon", -3, 21)).toEqual([]);
  });
});

describe("StageContext merging", () => {
  it("merges challenge_params into stage context deterministically", () => {
    const base = {
      seed: 7,
      kind: "city" as const,
      palette: { moon: 0xffffff },
      scenery: { moonCraters: 5 },
      dressing: { kind: "beacon" as const, count: 1 },
    };
    const overrides = {
      palette: { moon: 0x112233 },
      scenery: { moonCraters: 12 },
      dressing: { count: 3 },
    };
    const ctx = mergeStageContext(base, overrides);
    expect(ctx.seed).toBe(7);
    expect(ctx.kind).toBe("city");
    expect(ctx.palette?.moon).toBe(0x112233);
    expect(ctx.scenery?.moonCraters).toBe(12);
    expect(ctx.dressing?.count).toBe(3);
    expect(ctx.dressing?.kind).toBe("beacon");
  });

  it("keeps defaults when params are absent", () => {
    const base = { seed: 1, kind: "tote" as const, palette: { moon: 0x123456 } };
    const ctx = mergeStageContext(base);
    expect(ctx.seed).toBe(1);
    expect(ctx.kind).toBe("tote");
    expect(ctx.palette?.moon).toBe(0x123456);
  });
});

describe("vegetation", () => {
  const greenTurn = (green: number) =>
    turn({ housing: 10, transit: 10, health: 10, green, reserves: 10 });

  it("reads lushness from the mean green share", () => {
    expect(vegetationMood([])).toEqual({ lush01: 0.6, arid01: 0.4 });
    const even = vegetationMood([greenTurn(12.5), greenTurn(12.5)]);
    expect(even.lush01).toBeCloseTo(0.625, 3);
    expect(even.arid01).toBeCloseTo(0.375, 3);
    expect(vegetationMood([greenTurn(0)]).lush01).toBe(0);
    expect(vegetationMood([greenTurn(40)]).lush01).toBe(1);
  });

  it("lays groves deterministically inside the strip", () => {
    const a = groveSpots(6, 7, 5);
    const b = groveSpots(6, 7, 5);
    expect(a).toEqual(b);
    expect(a).toHaveLength(6);
    for (const spot of a) {
      expect(spot.x).toBeGreaterThanOrEqual(-10);
      expect(spot.x).toBeLessThanOrEqual(10);
      expect(spot.z).toBeGreaterThanOrEqual(-5.8);
      expect(spot.z).toBeLessThanOrEqual(-3.4);
      expect(spot.s).toBeGreaterThanOrEqual(0.8);
    }
    // Longer counts extend shorter ones; salts diverge.
    expect(groveSpots(8, 7, 5).slice(0, 6)).toEqual(a);
    expect(groveSpots(6, 7, 6)).not.toEqual(a);
    expect(groveSpots(0, 7, 5)).toEqual([]);
  });

  it("stands the hut clear of play, facing the centre", () => {
    const a = hutSpot(7);
    expect(hutSpot(7)).toEqual(a);
    expect(Math.abs(a.x)).toBe(7.5);
    expect(a.z).toBe(-1.5);
    expect(a.rotY).toBeCloseTo(Math.atan2(0 - a.x, 0 - a.z), 6);
    // Both sides occur across seeds.
    const sides = new Set([1, 2, 3, 4, 5, 6, 7, 8].map((s) => Math.sign(hutSpot(s).x)));
    expect(sides).toEqual(new Set([-1, 1]));
  });
});
