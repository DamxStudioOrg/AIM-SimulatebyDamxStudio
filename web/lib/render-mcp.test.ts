import { describe, expect, it } from "vitest";
import { DEFAULT_ASSETS } from "./asset-schema";
import { CITY_KEYS } from "./city-scene";
import type { MatchResultPayload, MatchTurn, ToteCatalog, TotePackResult } from "./sim";
import type { Ctx } from "./iso";
import { ISO_VIEW_FLAT, project } from "./iso";
import {
  RENDER_TOOLS,
  describeCityScene,
  describeToteScene,
  listProps,
  parseSceneJSON,
  pickDiscTurn,
  placeProp,
  renderScene,
  sceneCamera,
  sceneMaxY,
} from "./render-mcp";

interface CtxCall {
  method: string;
  args: unknown[];
}

/** Recording 2D context: painters run for real, pixels don't. */
function stubCtx(log: CtxCall[]): Ctx {
  return new Proxy(
    {},
    {
      get:
        (_target: unknown, prop: string) =>
        (...args: unknown[]): void => {
          log.push({ method: prop, args });
        },
      set: (): boolean => true,
    },
  ) as unknown as Ctx;
}

function turn(allocation: Record<string, number>, n = 1): MatchTurn {
  return {
    turn: n,
    state_hash: "x",
    skip_reason: null,
    tokens_used: 100,
    usage_anomaly: false,
    spend: 105000,
    allocation,
    policies: [],
  };
}

function even(): Record<string, number> {
  return Object.fromEntries(CITY_KEYS.map((key) => [key, 100 / CITY_KEYS.length]));
}

function cityResult(): MatchResultPayload {
  return {
    seed: 7,
    provider: "demo",
    scores: {},
    totals: {},
    loss_reasons: [],
    turns: Array.from({ length: 12 }, (_, i) => turn(even(), i + 1)),
    badges: [],
    strategy: {
      mean_allocation: {},
      policies: {},
      played_turns: 12,
      skipped_turns: 0,
    },
    prompt_words: 40,
    token_budget: 8000,
  };
}

function cityInput(t: number) {
  return {
    result: cityResult(),
    t,
    turnFloat: 5.5,
    selectedTurn: null as number | null,
    reduced: false,
    assets: DEFAULT_ASSETS,
    heightScale: 1,
    widthScale: 1,
    companion: { scale: 1, angle: 0.6 },
    totalMs: 8000,
  };
}

function toteResult(packing: string[]): TotePackResult {
  return {
    seed: 3,
    provider: "demo",
    uid: "u",
    offered: packing,
    packing,
    value: 10,
    damage: { overweight: 0, crush: 0, stain: 0, cut: 0, total: 0 },
    score: 40,
    totals: { tokens_used: 50 },
    invalid_reason: null,
    scarce: [],
    wildcards: [],
    badges: [],
    bonus: 0,
    usage_anomaly: false,
  };
}

function toteCatalog(): ToteCatalog {
  return {
    capacity_kg: 20,
    items: [
      { id: "a", label: "A", weight: 2, value: 5, fragile: false, tags: [] },
      { id: "b", label: "B", weight: 4, value: 5, fragile: true, tags: [] },
    ],
  };
}

describe("parseSceneJSON", () => {
  it("accepts a minimal scene and fills prop defaults", () => {
    const parsed = parseSceneJSON({
      version: 1,
      game: "city",
      seed: 7,
      turn: 6,
      shock: null,
      progress01: 0.5,
      t: 4000,
      ground: { disc: 0xcfc4bb, dots: 0x9a8d84, seed: 7 },
      weather: { kind: null, amount: 0, shakeX: 0, shakeY: 0 },
      rain: null,
      props: [{ id: "tower:housing", kind: "tower", x: 0, z: 1 }],
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.props).toHaveLength(1);
    expect(parsed.value.props[0]).toMatchObject({
      id: "tower:housing",
      kind: "tower",
      y: 0,
      size: 1,
      color: 0xffffff,
    });
  });

  it("rejects unknown versions, kinds, keys, and bad numbers", () => {
    const base = {
      version: 1,
      game: "city",
      seed: 7,
      turn: 6,
      shock: null,
      progress01: 0.5,
      t: 4000,
      ground: { disc: 0xcfc4bb, dots: 0x9a8d84, seed: 7 },
      weather: { kind: null, amount: 0, shakeX: 0, shakeY: 0 },
      rain: null,
      props: [],
    };
    expect(parseSceneJSON({ ...base, version: 2 }).ok).toBe(false);
    expect(
      parseSceneJSON({
        ...base,
        props: [{ id: "x", kind: "dragon", x: 0, z: 0 }],
      }).ok,
    ).toBe(false);
    expect(
      parseSceneJSON({
        ...base,
        props: [{ id: "x", kind: "rock", x: Number.NaN, z: 0 }],
      }).ok,
    ).toBe(false);
    expect(
      parseSceneJSON({
        ...base,
        props: [{ id: "x", kind: "rock", x: 0, z: 0, cheat: 1 }],
      }).ok,
    ).toBe(false);
    expect(parseSceneJSON({ ...base, extra: 1 }).ok).toBe(false);
  });
});

describe("placeProp + listProps", () => {
  it("upserts by id without mutating the input", () => {
    const scene = describeCityScene(cityInput(4000));
    const before = scene.props.length;
    const hut = scene.props.find((p) => p.kind === "hut");
    expect(hut).toBeDefined();
    const moved = placeProp(scene, {
      id: hut?.id ?? "hut",
      kind: "hut",
      x: 1,
      z: 2,
    });
    expect(moved.props).toHaveLength(before);
    expect(moved.props.find((p) => p.id === hut?.id)?.x).toBe(1);
    expect(scene.props.find((p) => p.id === hut?.id)?.x).not.toBe(1);
    const summary = listProps(moved);
    expect(summary.find((s) => s.id === hut?.id)).toMatchObject({
      kind: "hut",
      x: 1,
      z: 2,
    });
  });
});

describe("describeCityScene", () => {
  it("is deterministic and lays towers, discs, crane, hut, grove", () => {
    const a = describeCityScene(cityInput(4000));
    const b = describeCityScene(cityInput(4000));
    expect(a).toEqual(b);
    const kinds = a.props.map((p) => p.kind);
    expect(kinds.filter((k) => k === "tower")).toHaveLength(CITY_KEYS.length);
    expect(kinds.filter((k) => k === "disc")).toHaveLength(12);
    expect(kinds).toContain("crane");
    expect(kinds).toContain("tote");
    expect(kinds).toContain("hut");
    expect(kinds).toContain("companion");
    expect(kinds.filter((k) => k === "tree" || k === "pine")).toHaveLength(
      DEFAULT_ASSETS.scenery.trees,
    );
  });

  it("grows tower height with the played share", () => {
    const low = describeCityScene(cityInput(4000));
    const rich = even();
    rich.housing = 60;
    const input = cityInput(4000);
    input.result.turns = Array.from({ length: 12 }, (_, i) => turn(rich, i + 1));
    const high = describeCityScene(input);
    const h = (id: string, props: typeof low.props): number =>
      props.find((p) => p.id === id)?.height ?? 0;
    expect(h("tower:housing", high.props)).toBeGreaterThan(
      h("tower:housing", low.props),
    );
  });

  it("marks the active disc and reports shock windows", () => {
    const scene = describeCityScene(cityInput(4000));
    expect(scene.turn).toBe(6);
    expect(scene.shock).toBe("flood");
    const active = scene.props.find((p) => p.id === "disc:6");
    expect(active?.state).toBe("active");
  });

  it("labels only the three biggest budget lines, stable across frames", () => {
    const rich = even();
    rich.housing = 60;
    const late = even();
    late.rescue = 60;
    const turns = Array.from({ length: 12 }, (_, i) =>
      turn(i < 11 ? rich : late, i + 1),
    );
    const labeled = (turnFloat: number): string[] => {
      const input = cityInput(4000);
      input.result.turns = turns;
      input.turnFloat = turnFloat;
      return describeCityScene(input)
        .props.filter((p) => p.kind === "tower" && p.label !== "")
        .map((p) => p.id)
        .sort();
    };
    // Housing dominates match totals even though the last frame is rescue's.
    expect(labeled(5.5)).toHaveLength(3);
    expect(labeled(5.5)).toContain("tower:housing");
    expect(labeled(11.9)).toEqual(labeled(5.5));
  });

  it("keeps all twelve disc numbers", () => {
    const scene = describeCityScene(cityInput(4000));
    const discs = scene.props.filter((p) => p.kind === "disc");
    expect(discs).toHaveLength(12);
    expect(discs.every((p) => p.label !== "")).toBe(true);
  });

  it("lays lanterns, widths, and halo from v2 dressing", () => {
    const input = cityInput(4000);
    input.assets = {
      ...DEFAULT_ASSETS,
      scenery: { ...DEFAULT_ASSETS.scenery, lanterns: 4 },
      moon: { ...DEFAULT_ASSETS.moon, halo: 0.6 },
      towers: { ...DEFAULT_ASSETS.towers, widthScale: 1.4 },
    };
    input.widthScale = 1.4;
    const scene = describeCityScene(input);
    expect(scene.props.filter((p) => p.kind === "lantern")).toHaveLength(4);
    expect(scene.ground.halo).toBe(0.6);
    const towers = scene.props.filter((p) => p.kind === "tower");
    expect(towers.length).toBeGreaterThan(0);
    expect(towers.every((p) => p.size === 1.4)).toBe(true);
  });

  it("reads halo 0 on scenes recorded before dressing v2", () => {
    const parsed = parseSceneJSON({
      version: 1,
      game: "city",
      seed: 7,
      turn: 6,
      shock: null,
      progress01: 0.5,
      t: 4000,
      ground: { disc: 0xcfc4bb, dots: 0x9a8d84, seed: 7 },
      weather: { kind: null, amount: 0, shakeX: 0, shakeY: 0 },
      rain: null,
      props: [],
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.ground.halo).toBe(0);
  });

  it("parses halo on v2 scenes and rejects halo out of range", () => {
    const base = {
      version: 1,
      game: "city",
      seed: 7,
      turn: 6,
      shock: null,
      progress01: 0.5,
      t: 4000,
      weather: { kind: null, amount: 0, shakeX: 0, shakeY: 0 },
      rain: null,
      props: [],
    };
    const good = parseSceneJSON({
      ...base,
      ground: { disc: 0xcfc4bb, dots: 0x9a8d84, seed: 7, halo: 0.6 },
    });
    expect(good.ok).toBe(true);
    if (!good.ok) return;
    expect(good.value.ground.halo).toBe(0.6);
    expect(
      parseSceneJSON({
        ...base,
        ground: { disc: 0xcfc4bb, dots: 0x9a8d84, seed: 7, halo: 2 },
      }).ok,
    ).toBe(false);
  });
});

describe("describeToteScene", () => {
  it("flies crates from pallet to bin across the clock", () => {
    const input = {
      catalog: toteCatalog(),
      result: toteResult(["a", "b"]),
      t: 0,
      reduced: false,
      companion: { scale: 1, angle: 0.6 },
      totalMs: 5000,
    };
    const parked = describeToteScene({ ...input, t: 0 });
    const flying = describeToteScene({ ...input, t: 1800 });
    const landed = describeToteScene({ ...input, t: 4900 });
    const y = (id: string, props: typeof parked.props): number =>
      props.find((p) => p.id === id)?.y ?? 0;
    // First crate starts on the pallet, arcs high mid-flight, lands in the bin.
    expect(y("crate:a", parked.props)).toBeLessThan(1);
    expect(y("crate:a", flying.props)).toBeGreaterThan(2);
    expect(landed.props.find((p) => p.id === "crate:a")?.state).toBe("landed");
    expect(flying.props.find((p) => p.kind === "crane")?.angle).toBeDefined();
  });
});

describe("renderScene", () => {
  it("keeps every label inside the square", () => {
    const log: CtxCall[] = [];
    renderScene(stubCtx(log), describeCityScene(cityInput(4000)), 640);
    const texts = log.filter((call) => call.method === "fillText");
    // 3 tower leaders + 12 disc numbers.
    expect(texts.length).toBe(15);
    for (const call of texts) {
      const [, x, y] = call.args as [unknown, number, number];
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThanOrEqual(640);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(y).toBeLessThanOrEqual(640);
    }
  });

  it("paints ground, water, discs, and blobs as ellipses", () => {
    const log: CtxCall[] = [];
    renderScene(stubCtx(log), describeCityScene(cityInput(4000)), 640);
    const ellipses = log.filter((call) => call.method === "ellipse");
    // Ground + 11 craters + 12 discs + water + tower/tree blobs.
    expect(ellipses.length).toBeGreaterThan(30);
  });

  it("survives shocks, inspection, and empty turns without throwing", () => {
    const heat = cityInput(4000);
    heat.turnFloat = 9.5;
    const frozen = cityInput(4000);
    frozen.selectedTurn = 3;
    const empty = cityInput(4000);
    empty.result.turns = [];
    for (const input of [heat, frozen, empty]) {
      const log: CtxCall[] = [];
      expect(() => {
        renderScene(stubCtx(log), describeCityScene(input), 640);
      }).not.toThrow();
      expect(log.length).toBeGreaterThan(0);
    }
  });

  it("renders a mid-pack tote frame with crates and cable", () => {
    const log: CtxCall[] = [];
    renderScene(
      stubCtx(log),
      describeToteScene({
        catalog: toteCatalog(),
        result: toteResult(["a", "b"]),
        t: 1800,
        reduced: false,
        companion: { scale: 1, angle: 0.6 },
        totalMs: 5000,
      }),
      640,
    );
    const methods = new Set(log.map((call) => call.method));
    expect(methods.has("ellipse")).toBe(true);
    expect(methods.has("stroke")).toBe(true);
  });
});

describe("pickDiscTurn", () => {
  it("hits the disc under the point and misses the sky", () => {
    const scene = describeCityScene(cityInput(4000));
    const cam = sceneCamera("city", 640, sceneMaxY(scene));
    const discs = scene.props
      .filter((p) => p.kind === "disc")
      .map((p, i) => ({ turn: i + 1, x: p.x, z: p.z }));
    const sixth = discs[5];
    expect(sixth).toBeDefined();
    if (sixth === undefined) return;
    const c = project(cam, sixth.x, 0.05, sixth.z, ISO_VIEW_FLAT);
    expect(pickDiscTurn(discs, cam, ISO_VIEW_FLAT, c.x, c.y, 12)).toBe(6);
    expect(pickDiscTurn(discs, cam, ISO_VIEW_FLAT, 320, 10, 12)).toBe(null);
  });
});

describe("RENDER_TOOLS", () => {
  it("exposes a schema per tool for model callers", () => {
    const names = RENDER_TOOLS.map((t) => t.name);
    expect(names).toEqual([
      "describe_city",
      "describe_tote",
      "render_scene",
      "place_prop",
      "list_props",
      "validate_scene",
    ]);
    for (const tool of RENDER_TOOLS) {
      expect(tool.description.length).toBeGreaterThan(10);
      expect(tool.inputSchema).toMatchObject({ type: "object" });
    }
  });
});
