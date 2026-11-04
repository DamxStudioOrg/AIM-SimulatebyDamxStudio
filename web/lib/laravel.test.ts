import { afterEach, describe, expect, it, vi } from "vitest";
import { LaravelError, boardVersion } from "./laravel";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("boardVersion", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns the shipped triple on ok", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(
          jsonResponse({ version: "0.2.0", url: "https://x.test", notes: "" }),
        ),
      ),
    );
    await expect(boardVersion()).resolves.toEqual({
      version: "0.2.0",
      url: "https://x.test",
      notes: "",
    });
  });

  it("rejects a release URL that is not absolute http(s)", async () => {
    for (const url of ["javascript:alert(1)", "/releases", ""]) {
      vi.stubGlobal(
        "fetch",
        vi.fn(() =>
          Promise.resolve(jsonResponse({ version: "0.2.0", url, notes: "" })),
        ),
      );
      const error = await boardVersion().catch((cause: unknown) => cause);
      expect(error).toBeInstanceOf(LaravelError);
      expect((error as LaravelError).status).toBe(502);
    }
  });
});
