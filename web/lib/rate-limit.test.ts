import { describe, expect, it } from "vitest";
import { checkRateLimit } from "./rate-limit";

const RULE = { windowMs: 60_000, max: 3 };

describe("checkRateLimit", () => {
  it("allows up to max hits per window per key", () => {
    const buckets = new Map<string, number[]>();
    for (const at of [0, 1_000, 2_000]) {
      expect(checkRateLimit(buckets, "a", at, RULE).allowed).toBe(true);
    }
    const verdict = checkRateLimit(buckets, "a", 3_000, RULE);
    expect(verdict.allowed).toBe(false);
    expect(verdict.retryAfterSec).toBe(57);
    // A second key is unaffected.
    expect(checkRateLimit(buckets, "b", 3_000, RULE).allowed).toBe(true);
  });

  it("ages hits out so the window slides", () => {
    const buckets = new Map<string, number[]>();
    for (const at of [0, 1_000, 2_000]) {
      checkRateLimit(buckets, "a", at, RULE);
    }
    expect(checkRateLimit(buckets, "a", 3_000, RULE).allowed).toBe(false);
    // The t=0 hit aged out at t=60s.
    expect(checkRateLimit(buckets, "a", 60_000, RULE).allowed).toBe(true);
  });

  it("prunes empty buckets so idle clients cost nothing", () => {
    const buckets = new Map<string, number[]>();
    checkRateLimit(buckets, "a", 0, RULE);
    checkRateLimit(buckets, "a", 120_000, RULE);
    expect(buckets.get("a")).toEqual([120_000]);
  });
});
