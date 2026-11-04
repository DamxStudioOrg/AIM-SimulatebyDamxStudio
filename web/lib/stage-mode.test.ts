import { describe, expect, it } from "vitest";
import { DEFAULT_STAGE_MODE, STAGE_MODE_KEY, parseStageMode } from "./stage-mode";

describe("stage mode", () => {
  it("keeps the on-device slot stable", () => {
    expect(STAGE_MODE_KEY).toBe("aim-arena-mode");
    expect(DEFAULT_STAGE_MODE).toBe("controls");
  });

  it("parses both modes", () => {
    expect(parseStageMode("simulation")).toBe("simulation");
    expect(parseStageMode("controls")).toBe("controls");
  });

  it("falls back to Controls for anything else", () => {
    expect(parseStageMode(null)).toBe("controls");
    expect(parseStageMode(undefined)).toBe("controls");
    expect(parseStageMode("")).toBe("controls");
    expect(parseStageMode("moon")).toBe("controls");
    expect(parseStageMode("planet")).toBe("controls");
    expect(parseStageMode(42)).toBe("controls");
  });
});
