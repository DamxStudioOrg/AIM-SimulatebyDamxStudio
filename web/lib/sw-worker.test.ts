import { describe, expect, it } from "vitest";
import { GET } from "../app/sw.js/route";

/**
 * Worker contract pins: the generated script is the product here, so
 * the guarantees live as assertions on its source. Navigations stay
 * network-only (no stale shell), and the cache name is versioned so
 * an update drops every older cache on activate.
 */
describe("service worker", () => {
  it("versions the cache and never intercepts navigations", async () => {
    const body = await GET().text();
    expect(body).toContain('const CACHE = "aim-arena-v4"');
    expect(body).toContain('if (request.mode === "navigate") return;');
    // No document precache: old HTML must never be served to new chunks.
    expect(body).not.toContain('"/console"');
    // Assets still cache as an offline fallback; APIs stay untouched.
    expect(body).toContain("caches.open(CACHE)");
    expect(body).toContain('url.pathname.startsWith("/api/")');
    // Error responses pass through but never poison the offline cache.
    expect(body).toContain("if (!fresh.ok) return fresh;");
  });
});
