import { describe, expect, it } from "vitest";
import { isDarkFrame } from "./gl-watchdog";

function frame(
  pixels: number,
  fill: (index: number) => [number, number, number, number],
): number[] {
  const data: number[] = [];
  for (let i = 0; i < pixels; i += 1) {
    data.push(...fill(i));
  }
  return data;
}

describe("isDarkFrame", () => {
  it("reads an all-black frame as dark", () => {
    expect(isDarkFrame(frame(48 * 48, () => [0, 0, 0, 255]))).toBe(true);
  });

  it("reads a transparent frame as dark", () => {
    expect(isDarkFrame(frame(48 * 48, () => [0, 0, 0, 0]))).toBe(true);
  });

  it("reads an empty readback as dark", () => {
    expect(isDarkFrame([])).toBe(true);
  });

  it("reads a lit stage frame as healthy", () => {
    // Moon disc fills most of the view: three lit pixels in four.
    const data = frame(48 * 48, (i) =>
      i % 4 === 3 ? [0, 0, 0, 255] : [200, 180, 190, 255],
    );
    expect(isDarkFrame(data)).toBe(false);
  });

  it("ignores a few stray lit pixels", () => {
    const data = frame(48 * 48, (i) =>
      i === 0 ? [255, 255, 255, 255] : [0, 0, 0, 255],
    );
    expect(isDarkFrame(data)).toBe(true);
  });
});
