import { afterEach, describe, expect, it, vi } from "vitest";
import type * as middlewareModule from "../middleware";

async function loadMiddleware(): Promise<typeof middlewareModule> {
  return import("../middleware");
}

describe("landing-only middleware", () => {
  afterEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
  });

  it("404s console and api routes on public landing-only builds", async () => {
    vi.stubEnv("NEXT_PUBLIC_LANDING_ONLY", "1");
    const { config, middleware } = await loadMiddleware();
    expect(config.matcher).toEqual(["/console/:path*", "/api/:path*"]);
    const response = middleware();
    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: "Not found" });
  });

  it("passes everything through for Electron and local dev", async () => {
    vi.stubEnv("NEXT_PUBLIC_LANDING_ONLY", "");
    const { middleware } = await loadMiddleware();
    const response = middleware();
    expect(response.headers.get("x-middleware-next")).toBe("1");
  });
});

describe("api middleware", () => {
  afterEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
  });

  function apiRequest(ip: string, pathname = "/api/contract") {
    return {
      nextUrl: { pathname },
      headers: new Headers({ "x-forwarded-for": ip }),
    } as never;
  }

  it("marks proxy answers no-store and leaves pages alone", async () => {
    vi.stubEnv("NEXT_PUBLIC_LANDING_ONLY", "");
    const { middleware } = await loadMiddleware();
    const api = middleware(apiRequest("10.9.0.1"));
    expect(api.headers.get("cache-control")).toBe("no-store");
    const page = middleware(apiRequest("10.9.0.2", "/console"));
    expect(page.headers.get("cache-control")).toBeNull();
  });

  it("429s one IP past the window while others pass", async () => {
    vi.stubEnv("NEXT_PUBLIC_LANDING_ONLY", "");
    const { middleware } = await loadMiddleware();
    let last = middleware(apiRequest("10.9.0.3"));
    for (let call = 1; call < 240; call += 1) {
      last = middleware(apiRequest("10.9.0.3"));
    }
    expect(last.status).toBe(200);
    const limited = middleware(apiRequest("10.9.0.3"));
    expect(limited.status).toBe(429);
    expect(limited.headers.get("retry-after")).not.toBeNull();
    await expect(limited.json()).resolves.toEqual({
      error: "rate limited, retry shortly",
    });
    const other = middleware(apiRequest("10.9.0.4"));
    expect(other.status).toBe(200);
  });
});
