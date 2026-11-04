import { describe, expect, it } from "vitest";
import { diffStats, promptDiff } from "./prompt-diff";

describe("promptDiff", () => {
  it("marks identical prompts as one same segment", () => {
    expect(promptDiff("hold reserves", "hold reserves")).toEqual([
      { kind: "same", text: "hold reserves" },
    ]);
  });

  it("separates added and removed words", () => {
    const segments = promptDiff("fund housing first", "fund rescue first now");
    expect(segments).toEqual([
      { kind: "same", text: "fund" },
      { kind: "removed", text: "housing" },
      { kind: "added", text: "rescue" },
      { kind: "same", text: "first" },
      { kind: "added", text: "now" },
    ]);
    expect(diffStats(segments)).toEqual({ added: 2, removed: 1 });
  });

  it("handles empty sides", () => {
    expect(promptDiff("", "new prompt")).toEqual([
      { kind: "added", text: "new prompt" },
    ]);
    expect(diffStats(promptDiff("old prompt", ""))).toEqual({
      added: 0,
      removed: 2,
    });
  });
});
