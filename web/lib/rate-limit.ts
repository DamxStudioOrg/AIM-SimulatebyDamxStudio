/**
 * In-memory sliding-window rate limiter for the Next API proxies.
 * Single-instance only (local dev, standalone server, Electron):
 * each server process keeps its own buckets, which is exactly one
 * here. Callers own the bucket map so tests drive it directly.
 */

export interface RateLimitRule {
  /** Window length in milliseconds. */
  windowMs: number;
  /** Max hits per key inside one window. */
  max: number;
}

/**
 * Generous for one human driving the console (a three-variant match
 * is a handful of calls); tight enough to stop a runaway loop from
 * melting the sim or board behind the proxies.
 */
export const API_RATE_LIMIT: RateLimitRule = { windowMs: 60_000, max: 240 };

export interface RateLimitVerdict {
  allowed: boolean;
  /** Whole seconds until the oldest hit ages out; 0 when allowed. */
  retryAfterSec: number;
}

/**
 * Record one hit for `key` at `nowMs`. Prunes aged hits (and the
 * key itself when empty) so idle clients cost nothing.
 */
export function checkRateLimit(
  buckets: Map<string, number[]>,
  key: string,
  nowMs: number,
  rule: RateLimitRule,
): RateLimitVerdict {
  const cutoff = nowMs - rule.windowMs;
  const live = (buckets.get(key) ?? []).filter((stamp) => stamp > cutoff);
  if (live.length >= rule.max) {
    const oldest = live[0] ?? nowMs;
    buckets.set(key, live);
    return {
      allowed: false,
      retryAfterSec: Math.max(1, Math.ceil((oldest + rule.windowMs - nowMs) / 1000)),
    };
  }
  live.push(nowMs);
  buckets.set(key, live);
  return { allowed: true, retryAfterSec: 0 };
}
