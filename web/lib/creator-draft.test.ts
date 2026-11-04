import { describe, expect, it } from "vitest";
import { parseCreatorDraft, serializeCreatorDraft } from "./creator-draft";
import type { CreatorDraft } from "./creator-draft";

function draft(overrides?: Partial<CreatorDraft>): CreatorDraft {
  return {
    title: "Ember finals",
    description: "Survive the frost parade.",
    model: "Muse",
    inputPrompt: "Tend the groves.",
    outputFormat: "JSON allocations",
    restrictions: "",
    brief: "An ember moon over a lantern grove.",
    dressModel: "demo",
    dressing: null,
    ...overrides,
  };
}

function validDressing(): Record<string, unknown> {
  return {
    version: 2,
    palette: { moon: "moon", crater: "crater", accent: "brand", crane: "gold" },
    scenery: {
      trees: 12,
      clouds: 4,
      beacons: 6,
      pennants: 10,
      shrooms: 5,
      lanterns: 3,
    },
    moon: { craters: 14, size: 1.0, halo: 0.5 },
    towers: { heightScale: 1.0, widthScale: 1.2 },
  };
}

describe("creator draft autosave", () => {
  it("round-trips every field", () => {
    const parsed = parseCreatorDraft(serializeCreatorDraft(draft()));
    expect(parsed).toEqual(draft());
  });

  it("reads nothing when missing or malformed", () => {
    expect(parseCreatorDraft(null)).toBeNull();
    expect(parseCreatorDraft("")).toBeNull();
    expect(parseCreatorDraft("{oops")).toBeNull();
    expect(parseCreatorDraft("[]")).toBeNull();
    expect(parseCreatorDraft('"just a string"')).toBeNull();
  });

  it("repairs partial drafts instead of dropping them", () => {
    const parsed = parseCreatorDraft(JSON.stringify({ title: "Half" }));
    expect(parsed?.title).toBe("Half");
    expect(parsed?.description).toBe("");
    expect(parsed?.dressing).toBeNull();
  });

  it("caps runaway fields and coerces non-strings", () => {
    const parsed = parseCreatorDraft(
      JSON.stringify({ title: "x".repeat(9000), brief: 42 }),
    );
    expect(parsed?.title).toHaveLength(8000);
    expect(parsed?.brief).toBe("");
  });

  it("keeps valid dressing and drops anything else", () => {
    const dressed = parseCreatorDraft(
      JSON.stringify({ title: "t", dressing: validDressing() }),
    );
    expect(dressed?.dressing?.palette.crane).toBe("gold");
    const smuggled = parseCreatorDraft(
      JSON.stringify({
        title: "t",
        dressing: { ...validDressing(), gameplay: { shocks: 9 } },
      }),
    );
    expect(smuggled?.title).toBe("t");
    expect(smuggled?.dressing).toBeNull();
  });
});
