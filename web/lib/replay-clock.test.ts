import { describe, expect, it } from "vitest";
import { FINALE_MS, TICK_MS, TURNS, TYPE_MS, scrubTrack, turnAt } from "./replay-clock";

describe("turnAt", () => {
  it("holds turn 1 through the typing window", () => {
    expect(turnAt(0)).toBe(1);
    expect(turnAt(TYPE_MS - 1)).toBe(1);
  });

  it("advances one turn per tick and clamps at the finale", () => {
    expect(turnAt(TYPE_MS + 1)).toBe(1);
    expect(turnAt(TYPE_MS + TICK_MS + 1)).toBe(2);
    expect(turnAt(TYPE_MS + TURNS * TICK_MS + FINALE_MS)).toBe(TURNS);
  });
});

describe("scrubTrack", () => {
  it("grades the played fill and clamps the split point", () => {
    expect(scrubTrack(500, 1000)).toBe(
      "linear-gradient(to right, var(--brand) 0%, var(--gold) 50.0%, var(--surface-3) 50.0%, var(--line) 100%)",
    );
    expect(scrubTrack(-5, 1000)).toContain("0.0%");
    expect(scrubTrack(5000, 1000)).toContain("100.0%");
    expect(scrubTrack(0, 0)).toContain("0.0%");
  });
});
