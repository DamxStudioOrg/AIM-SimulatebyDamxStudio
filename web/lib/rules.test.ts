import { describe, expect, it } from "vitest";
import { OUTPUT_RULES, POLICY_CARDS, SAMPLE_PLAYS, TURN_RULES } from "./rules";

describe("turn rules", () => {
  it("covers exactly twelve turns in order", () => {
    expect(TURN_RULES.map((rule) => rule.turn)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12,
    ]);
  });

  it("marks the shock turns the simulator triggers", () => {
    const shocks = TURN_RULES.filter((rule) => rule.phase === "shock").map(
      (rule) => rule.turn,
    );
    expect(shocks).toEqual([5, 9]);
  });

  it("describes events without prescribing moves", () => {
    for (const rule of TURN_RULES) {
      expect(rule.event.length).toBeGreaterThan(0);
      expect("optimize" in rule).toBe(false);
    }
  });

  it("lists the six allowlisted policies", () => {
    expect(POLICY_CARDS.map((card) => card.name).sort()).toEqual(
      [
        "curfew",
        "emergency_hire_medics",
        "evacuate_district",
        "open_shelters",
        "ration_water",
        "request_mutual_aid",
      ].sort(),
    );
  });

  it("states the output contract", () => {
    expect(OUTPUT_RULES.length).toBeGreaterThan(0);
  });

  it("sample plays cover all four phases", () => {
    expect(SAMPLE_PLAYS.map((play) => play.phase)).toEqual([
      "stewardship",
      "shock",
      "response",
      "recovery",
    ]);
  });

  it("sample plays validate against the sim contract", () => {
    const keys = [
      "green",
      "health",
      "housing",
      "repair",
      "rescue",
      "reserves",
      "shelter",
      "transit",
    ];
    const allowed = new Set([
      "curfew",
      "emergency_hire_medics",
      "evacuate_district",
      "open_shelters",
      "ration_water",
      "request_mutual_aid",
    ]);
    for (const play of SAMPLE_PLAYS) {
      const parsed = JSON.parse(play.json) as {
        allocation: Record<string, number>;
        policies: string[];
      };
      expect(Object.keys(parsed.allocation).sort()).toEqual(keys);
      const sum = Object.values(parsed.allocation).reduce((a, b) => a + b, 0);
      expect(Math.abs(sum - 100)).toBeLessThanOrEqual(0.01);
      expect(parsed.policies.length).toBeLessThanOrEqual(2);
      for (const policy of parsed.policies) {
        expect(allowed.has(policy)).toBe(true);
      }
    }
  });
});
