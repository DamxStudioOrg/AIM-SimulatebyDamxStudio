import { describe, expect, it } from "vitest";
import { countWords } from "./words";

describe("countWords", () => {
  it("counts an empty prompt as zero", () => {
    expect(countWords("")).toBe(0);
    expect(countWords("   \n\t  ")).toBe(0);
  });

  it("counts plain words", () => {
    expect(countWords("steward wisely")).toBe(2);
  });

  it("collapses irregular whitespace", () => {
    expect(countWords("  hold   the\neast\tfront ")).toBe(4);
  });

  it("matches the 250-word cap boundary", () => {
    expect(countWords("word ".repeat(250))).toBe(250);
    expect(countWords("word ".repeat(251))).toBe(251);
  });

  it("matches Python str.split on control separators", () => {
    expect(countWords("a\x85b")).toBe(2);
    expect(countWords("a\x1Cb")).toBe(2);
    expect(countWords("a\x1Db")).toBe(2);
    expect(countWords("a\x1Eb")).toBe(2);
    expect(countWords("a\x1Fb")).toBe(2);
  });

  it("does not split on a zero-width no-break space", () => {
    expect(countWords("a\uFEFFb")).toBe(1);
    expect(countWords("\uFEFFa b")).toBe(2);
  });
});
