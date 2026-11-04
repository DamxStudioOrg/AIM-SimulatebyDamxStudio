import { describe, expect, it } from "vitest";
import {
  INTERVENTION_GUIDE,
  INTERVENTION_KINDS,
  addFieldEntry,
  interventionGuide,
  interventionLabel,
  isInterventionKind,
  removeFieldEntry,
} from "./field-plan";

describe("field plan", () => {
  it("adds entries sorted by turn", () => {
    const first = addFieldEntry([], 5, "irrigate");
    expect(first.error).toBeNull();
    const second = addFieldEntry(first.plan, 2, "terrace");
    expect(second.error).toBeNull();
    expect(second.plan).toEqual([
      { turn: 2, kind: "terrace" },
      { turn: 5, kind: "irrigate" },
    ]);
  });

  it("refuses a fourth entry", () => {
    const plan = [
      { turn: 1, kind: "irrigate" },
      { turn: 2, kind: "vent_heat" },
      { turn: 3, kind: "terrace" },
    ];
    const next = addFieldEntry(plan, 4, "irrigate");
    expect(next.plan).toEqual(plan);
    expect(next.error).toBe("Field plan is full — remove one first.");
  });

  it("refuses two entries on one turn", () => {
    const next = addFieldEntry([{ turn: 5, kind: "irrigate" }], 5, "terrace");
    expect(next.plan).toEqual([{ turn: 5, kind: "irrigate" }]);
    expect(next.error).toBe("Turn 5 already has an intervention.");
  });

  it("refuses turns outside the match and unknown kinds", () => {
    expect(addFieldEntry([], 0, "irrigate").error).toBe(
      "Turn must be between 1 and 12.",
    );
    expect(addFieldEntry([], 13, "irrigate").error).toBe(
      "Turn must be between 1 and 12.",
    );
    expect(addFieldEntry([], 4, "nuke").error).toBe("Unknown intervention.");
  });

  it("removes entries by turn", () => {
    const plan = [
      { turn: 2, kind: "terrace" },
      { turn: 5, kind: "irrigate" },
    ];
    expect(removeFieldEntry(plan, 2)).toEqual([{ turn: 5, kind: "irrigate" }]);
    expect(removeFieldEntry(plan, 9)).toEqual(plan);
  });

  it("labels known kinds and passes unknown ids through", () => {
    expect(interventionLabel("vent_heat")).toBe("Vent heat");
    expect(interventionLabel("future-kind")).toBe("future-kind");
  });

  it("guards intervention kinds", () => {
    expect(isInterventionKind("terrace")).toBe(true);
    expect(isInterventionKind("nuke")).toBe(false);
  });

  it("guides every kind with its terrain effect and moment", () => {
    for (const kind of INTERVENTION_KINDS) {
      const guide = INTERVENTION_GUIDE[kind];
      expect(guide.effect.length).toBeGreaterThan(10);
      expect(guide.when.length).toBeGreaterThan(10);
      expect(interventionGuide(kind)).toBe(guide);
    }
    expect(INTERVENTION_GUIDE.irrigate.effect).toContain("moisture");
    expect(INTERVENTION_GUIDE.vent_heat.effect).toContain("heat");
    expect(INTERVENTION_GUIDE.terrace.effect).toContain("erosion");
    expect(interventionGuide("nuke")).toBeNull();
  });
});
