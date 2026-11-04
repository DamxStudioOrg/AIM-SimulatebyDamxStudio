import { describe, expect, it } from "vitest";
import { analyzePrompt, craftCorrelation, craftScatterPoints } from "./prompt-analysis";

const FULL =
  "Fund housing 30%, health 25%, transit 15%, green 10%, rescue 10%, shelter 10%. " +
  "Keep reserves at 15% or more, never below the floor. If a flood hits, shift to rescue " +
  "and shelter; when heat rises, fund green. Pre-position before the turn 5 shock. " +
  "Reply with JSON only, concise.";

describe("analyzePrompt", () => {
  it("scores an empty prompt at zero with every move missing", () => {
    const analysis = analyzePrompt("");
    expect(analysis.score).toBe(0);
    expect(analysis.items.every((entry) => entry.state === "missing")).toBe(true);
    expect(analysis.departmentsNamed).toEqual([]);
  });

  it("rewards a structured steward prompt across every check", () => {
    const analysis = analyzePrompt(FULL);
    expect(analysis.score).toBeGreaterThanOrEqual(90);
    expect(analysis.items.every((entry) => entry.state === "have")).toBe(true);
    expect(analysis.departmentsNamed).toContain("housing");
    expect(analysis.departmentsNamed).toContain("rescue");
  });

  it("grades partial credit: departments without numbers or rules", () => {
    const analysis = analyzePrompt(
      "Look after housing, health, transit, green, shelter and repair for the city.",
    );
    const byId = new Map(analysis.items.map((entry) => [entry.id, entry]));
    expect(byId.get("departments")?.state).toBe("have");
    expect(byId.get("numbers")?.state).toBe("missing");
    expect(byId.get("conditionals")?.state).toBe("missing");
    expect(analysis.score).toBeGreaterThan(0);
    expect(analysis.score).toBeLessThan(60);
  });

  it("adds a hazard check only when the trial names hazards", () => {
    const bare = analyzePrompt(FULL);
    expect(bare.items.some((entry) => entry.id === "hazards")).toBe(false);
    const floodTrial = {
      title: "Flood wall",
      brief: "A severity-5 flood hits the west district.",
      drivers: ["severity-5 flood", "west exposure"],
    };
    const answered = analyzePrompt(FULL, floodTrial);
    expect(answered.items.find((entry) => entry.id === "hazards")?.state).toBe("have");
    const silent = analyzePrompt(
      "Fund housing 40% and health 30%. Keep reserves high. Reply JSON only.",
      floodTrial,
    );
    expect(silent.items.find((entry) => entry.id === "hazards")?.state).toBe("missing");
  });
});

describe("craftCorrelation", () => {
  it("stays silent until both sides have runs", () => {
    expect(craftCorrelation([])).toBeNull();
    expect(
      craftCorrelation([
        { prompt: FULL, impact: 80 },
        { prompt: FULL, impact: 70 },
      ]),
    ).toBeNull();
  });

  it("builds scatter points from saved prompts only, capped", () => {
    const points = craftScatterPoints(
      [
        { prompt: FULL, impact: 80 },
        { prompt: "", impact: 99 },
        { prompt: "help the city please", impact: 40 },
      ],
      1,
    );
    expect(points).toHaveLength(1);
    expect(points[0]?.impact).toBe(80);
    expect(points[0]?.craft).toBeGreaterThanOrEqual(90);
  });

  it("compares the player's structured runs against the rest", () => {
    const weak = "help the city please";
    const result = craftCorrelation([
      { prompt: FULL, impact: 80 },
      { prompt: FULL, impact: 70 },
      { prompt: weak, impact: 40 },
      { prompt: weak, impact: 50 },
      { prompt: "", impact: 99 },
    ]);
    expect(result).toMatchObject({
      highAvg: 75,
      lowAvg: 45,
      highCount: 2,
      lowCount: 2,
      delta: 30,
    });
  });
});
