import { describe, expect, it } from "vitest";

import { DEPARTMENT_BRIEFS, INCOME_NOTE, OPENING_STATE } from "./departments";

describe("DEPARTMENT_BRIEFS", () => {
  it("covers the sim's eight allocation keys in order", () => {
    expect(DEPARTMENT_BRIEFS.map((entry) => entry.id)).toEqual([
      "housing",
      "transit",
      "health",
      "green",
      "reserves",
      "rescue",
      "shelter",
      "repair",
    ]);
  });

  it("quotes a concrete amount and a note for every department", () => {
    for (const entry of DEPARTMENT_BRIEFS) {
      expect(entry.label).not.toBe("");
      expect(entry.per10).not.toBe("");
      expect(entry.detail).not.toBe("");
    }
    // Spot rates from the sim's investment math at base income.
    const byId = new Map(DEPARTMENT_BRIEFS.map((entry) => [entry.id, entry]));
    expect(byId.get("rescue")?.per10).toContain("54 lives");
    expect(byId.get("reserves")?.detail).toContain("$240k");
    expect(byId.get("transit")?.detail).toContain("3 turns later");
  });

  it("states the opening city and the shock schedule", () => {
    expect(OPENING_STATE).toContain("≈$122k");
    expect(OPENING_STATE).toContain("$60k reserves");
    expect(INCOME_NOTE).toContain("turns 5 (flood) and 9");
    expect(INCOME_NOTE).toContain("3-turn crisis window");
  });
});
