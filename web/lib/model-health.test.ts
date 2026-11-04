import { describe, expect, it } from "vitest";
import { modelHealth } from "./model-health";

describe("modelHealth", () => {
  it("treats listed local models as reachable", () => {
    expect(modelHealth("local", false).state).toBe("ready-local");
  });

  it("distinguishes hosted readiness by saved key", () => {
    expect(modelHealth("hosted", true).state).toBe("ready-key");
    expect(modelHealth("hosted", false).state).toBe("needs-key");
    expect(modelHealth("hosted", false).label).toContain("Connect a bot");
  });
});
