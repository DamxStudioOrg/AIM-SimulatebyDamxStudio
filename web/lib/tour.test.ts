import { describe, expect, it } from "vitest";
import { TOUR_STEPS, firstStepForPage } from "./tour";

describe("tour steps", () => {
  it("walks every signed-in page in order", () => {
    const pages = [...new Set(TOUR_STEPS.map((step) => step.page))];
    expect(pages).toEqual(["/console", "/prompts", "/ranks", "/account", "/docs"]);
    const ids = TOUR_STEPS.map((step) => step.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const step of TOUR_STEPS) {
      expect(step.title).not.toBe("");
      expect(step.desc).not.toBe("");
      expect(step.pageLabel).not.toBe("");
    }
  });

  it("starts a page at its first step, unknown pages at the top", () => {
    expect(TOUR_STEPS[firstStepForPage("/console")]?.id).toBe("pick");
    expect(TOUR_STEPS[firstStepForPage("/ranks")]?.id).toBe("board");
    expect(TOUR_STEPS[firstStepForPage("/account")]?.id).toBe("arena-id");
    expect(firstStepForPage("/nowhere")).toBe(0);
  });
});
