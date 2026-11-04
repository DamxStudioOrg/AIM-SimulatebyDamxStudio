import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { REVEAL_TIMEOUT_MS, createTimedReveal } from "./timed-reveal";

describe("createTimedReveal", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("starts hidden and auto-hides after the timeout", () => {
    const seen: boolean[] = [];
    const reveal = createTimedReveal((visible) => {
      seen.push(visible);
    });
    expect(reveal.visible).toBe(false);
    reveal.reveal();
    expect(reveal.visible).toBe(true);
    vi.advanceTimersByTime(REVEAL_TIMEOUT_MS);
    expect(reveal.visible).toBe(false);
    expect(seen).toEqual([true, false]);
    reveal.dispose();
  });

  it("hide masks immediately and cancels the pending auto-hide", () => {
    const seen: boolean[] = [];
    const reveal = createTimedReveal((visible) => {
      seen.push(visible);
    });
    reveal.reveal();
    reveal.hide();
    expect(reveal.visible).toBe(false);
    vi.advanceTimersByTime(REVEAL_TIMEOUT_MS * 2);
    expect(reveal.visible).toBe(false);
    expect(seen).toEqual([true, false]);
    reveal.dispose();
  });

  it("re-reveal re-arms the timeout", () => {
    const seen: boolean[] = [];
    const reveal = createTimedReveal((visible) => {
      seen.push(visible);
    });
    reveal.reveal();
    vi.advanceTimersByTime(REVEAL_TIMEOUT_MS - 1);
    reveal.reveal();
    vi.advanceTimersByTime(REVEAL_TIMEOUT_MS - 1);
    expect(reveal.visible).toBe(true);
    vi.advanceTimersByTime(1);
    expect(reveal.visible).toBe(false);
    reveal.dispose();
  });

  it("dispose clears the pending auto-hide", () => {
    const seen: boolean[] = [];
    const reveal = createTimedReveal((visible) => {
      seen.push(visible);
    });
    reveal.reveal();
    reveal.dispose();
    vi.advanceTimersByTime(REVEAL_TIMEOUT_MS * 2);
    expect(seen).toEqual([true]);
  });
});
