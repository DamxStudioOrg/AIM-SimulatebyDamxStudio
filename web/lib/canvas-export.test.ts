import { describe, expect, it } from "vitest";
import { exportFilename, exportVideoFilename, recordCanvasWebm } from "./canvas-export";

describe("exportFilename", () => {
  it("names city exports with the seed", () => {
    expect(exportFilename("city", 7)).toBe("simulate-city-seed7.png");
  });

  it("names tote exports with the seed", () => {
    expect(exportFilename("tote", 4)).toBe("simulate-tote-seed4.png");
  });
});

describe("exportVideoFilename", () => {
  it("names animated exports as webm with the seed", () => {
    expect(exportVideoFilename("city", 7)).toBe("simulate-city-seed7.webm");
  });

  it("recording without a canvas resolves false", async () => {
    await expect(recordCanvasWebm(null, "x.webm", 10)).resolves.toBe(false);
  });
});
