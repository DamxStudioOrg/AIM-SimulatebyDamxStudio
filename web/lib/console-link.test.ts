import { describe, expect, it } from "vitest";
import { buildConsoleLink, buildToteLink, parsePlayParams } from "./console-link";

describe("console-link", () => {
  it("builds a console link with blanks dropped", () => {
    expect(buildConsoleLink({})).toBe("/console");
    expect(
      buildConsoleLink({ challenge: "open-trial", prompt: "hold reserves", seed: "7" }),
    ).toBe("/console?challenge=open-trial&prompt=hold+reserves&seed=7");
    expect(buildConsoleLink({ challenge: "", prompt: "x", seed: "" })).toBe(
      "/console?prompt=x",
    );
  });

  it("caps prompts at 4000 chars", () => {
    const link = buildConsoleLink({ prompt: "x".repeat(5000) });
    expect(link.length).toBeLessThan(5000);
    expect(parsePlayParams(link.slice("/console".length)).prompt?.length).toBe(4000);
  });

  it("builds a tote link onto the console without the challenge param", () => {
    expect(buildToteLink({})).toBe("/console?game=tote");
    expect(buildToteLink({ prompt: "pack light", seed: "3" })).toBe(
      "/console?game=tote&prompt=pack+light&seed=3",
    );
  });

  it("parses params back, blanks as undefined", () => {
    expect(parsePlayParams("?challenge=a&prompt=b&seed=c")).toEqual({
      challenge: "a",
      prompt: "b",
      seed: "c",
    });
    expect(parsePlayParams("")).toEqual({});
    expect(parsePlayParams("?prompt=&seed=5")).toEqual({ seed: "5" });
    expect(parsePlayParams("?game=tote&prompt=p&seed=3")).toEqual({
      prompt: "p",
      seed: "3",
      game: "tote",
    });
  });
});
