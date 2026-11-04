import { afterEach, describe, expect, it, vi } from "vitest";
import {
  SimRouteError,
  fetchSimCall,
  fetchSimCallStream,
  getSimRoute,
  probeLocalSim,
  saveLocalSim,
  setSimRoute,
} from "./direct-sim";

afterEach(() => {
  vi.unstubAllGlobals();
  setSimRoute("proxy");
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function store(): Record<string, string> {
  const saved: Record<string, string> = {};
  vi.stubGlobal("window", {
    localStorage: {
      getItem: (key: string) => saved[key] ?? null,
      setItem: (key: string, value: string) => {
        saved[key] = value;
      },
    },
  });
  return saved;
}

describe("fetchSimCall", () => {
  it("uses the proxy when healthy and marks the route", async () => {
    store();
    setSimRoute("direct");
    const fetch = vi.fn((url: string) =>
      Promise.resolve(jsonResponse({ ok: url.includes("/api/") })),
    );
    vi.stubGlobal("fetch", fetch);

    const response = await fetchSimCall(
      { path: "/api/contract" },
      { path: "/contract" },
    );

    expect(await response.json()).toEqual({ ok: true });
    expect(getSimRoute()).toBe("proxy");
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("never fails over on semantic proxy failures", async () => {
    store();
    const fetch = vi.fn(() => Promise.resolve(jsonResponse({ error: "bad" }, 422)));
    vi.stubGlobal("fetch", fetch);

    const response = await fetchSimCall(
      { path: "/api/match" },
      { path: "/matches/run" },
    );

    expect(response.status).toBe(422);
    expect(getSimRoute()).toBe("proxy");
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("fails over to the local endpoint when the proxy dies", async () => {
    store();
    const fetch = vi.fn((url: string) => {
      if (url.startsWith("/api/")) {
        return Promise.reject(new TypeError("down"));
      }
      return Promise.resolve(jsonResponse({ sim_version: "0.1.0" }));
    });
    vi.stubGlobal("fetch", fetch);

    const response = await fetchSimCall(
      { path: "/api/contract" },
      { path: "/contract" },
    );

    expect(response.ok).toBe(true);
    expect(getSimRoute()).toBe("direct");
    expect(fetch).toHaveBeenCalledWith("http://localhost:8000/contract", undefined);
  });

  it("fails over on a 503 proxy with a dead sim behind it", async () => {
    store();
    const fetch = vi.fn((url: string) =>
      url.startsWith("/api/")
        ? Promise.resolve(jsonResponse({ error: "x" }, 503))
        : Promise.resolve(jsonResponse({ sim_version: "0.1.0" })),
    );
    vi.stubGlobal("fetch", fetch);

    const response = await fetchSimCall(
      { path: "/api/contract" },
      { path: "/contract" },
    );

    expect(response.ok).toBe(true);
    expect(getSimRoute()).toBe("direct");
  });

  it("normalizes direct rejections into the {error} shape", async () => {
    store();
    const fetch = vi.fn((url: string) =>
      url.startsWith("/api/")
        ? Promise.reject(new TypeError("down"))
        : Promise.resolve(jsonResponse({ detail: { error: "bad_limits" } }, 422)),
    );
    vi.stubGlobal("fetch", fetch);

    const response = await fetchSimCall(
      { path: "/api/match" },
      { path: "/matches/run", model: "m" },
    );

    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({
      error: "match limits must be positive integers within the sim's caps",
    });
  });

  it("names the cause when the sim reports one", async () => {
    store();
    const fetch = vi.fn((url: string) =>
      url.startsWith("/api/")
        ? Promise.reject(new TypeError("down"))
        : Promise.resolve(
            jsonResponse(
              { detail: { error: "provider_failed", reason: "unreachable" } },
              502,
            ),
          ),
    );
    vi.stubGlobal("fetch", fetch);

    const response = await fetchSimCall(
      { path: "/api/match" },
      { path: "/matches/run", model: "ollama/m" },
    );

    expect(response.status).toBe(502);
    const body = (await response.json()) as { error: string };
    expect(body.error).toContain("502");
    expect(body.error).toContain("not answering");
  });

  it("keeps the bare status when the sim names nothing", async () => {
    store();
    const fetch = vi.fn((url: string) =>
      url.startsWith("/api/")
        ? Promise.reject(new TypeError("down"))
        : Promise.resolve(jsonResponse({ detail: { error: "provider_failed" } }, 502)),
    );
    vi.stubGlobal("fetch", fetch);

    const response = await fetchSimCall(
      { path: "/api/match" },
      { path: "/matches/run", model: "ollama/m" },
    );

    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({
      error: "local sim request failed (status 502)",
    });
  });

  it("throws SimRouteError when both legs die", async () => {
    store();
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new TypeError("down"))),
    );

    await expect(
      fetchSimCall({ path: "/api/contract" }, { path: "/contract" }),
    ).rejects.toBeInstanceOf(SimRouteError);
  });

  it("returns the dead proxy response when direct also throws", async () => {
    store();
    const fetch = vi.fn((url: string) =>
      url.startsWith("/api/")
        ? Promise.resolve(jsonResponse({ error: "x", hint: "y" }, 503))
        : Promise.reject(new TypeError("down")),
    );
    vi.stubGlobal("fetch", fetch);

    const response = await fetchSimCall(
      { path: "/api/contract" },
      { path: "/contract" },
    );

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "x", hint: "y" });
  });
});

describe("fetchSimCallStream", () => {
  it("passes the proxy body through untouched for live reading", async () => {
    store();
    const fetch = vi.fn(() =>
      Promise.resolve(
        new Response("data: {}\n\n", {
          status: 200,
          headers: { "content-type": "text/event-stream" },
        }),
      ),
    );
    vi.stubGlobal("fetch", fetch);

    const response = await fetchSimCallStream(
      { path: "/api/match-stream" },
      { path: "/matches/stream" },
    );

    expect(response.headers.get("content-type")).toBe("text/event-stream");
    expect(await response.text()).toBe("data: {}\n\n");
    expect(getSimRoute()).toBe("proxy");
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("fails over to direct on a dead proxy and throws when both die", async () => {
    store();
    const fetch = vi.fn((url: string) => {
      if (url.startsWith("/api/")) {
        return Promise.reject(new TypeError("down"));
      }
      return Promise.resolve(new Response("data: {}\n\n", { status: 200 }));
    });
    vi.stubGlobal("fetch", fetch);

    const response = await fetchSimCallStream(
      { path: "/api/match-stream" },
      { path: "/matches/stream" },
    );
    expect(response.ok).toBe(true);
    expect(getSimRoute()).toBe("direct");

    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new TypeError("down"))),
    );
    await expect(
      fetchSimCallStream({ path: "/api/match-stream" }, { path: "/matches/stream" }),
    ).rejects.toBeInstanceOf(SimRouteError);
  });
});

describe("saveLocalSim", () => {
  it("accepts http(s) endpoints and strips paths", () => {
    const saved = store();
    expect(saveLocalSim("http://localhost:8000/")).toBe(true);
    expect(saved["aim-local-sim"]).toBe("http://localhost:8000");
    expect(saveLocalSim("https://sim.example:9000/deep")).toBe(true);
    expect(saved["aim-local-sim"]).toBe("https://sim.example:9000");
  });

  it("rejects non-http values", () => {
    store();
    expect(saveLocalSim("not a url")).toBe(false);
    expect(saveLocalSim("ftp://x")).toBe(false);
    expect(saveLocalSim("")).toBe(false);
  });
});

describe("probeLocalSim", () => {
  it("reports reachability with version detail", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(jsonResponse({ sim_version: "0.1.0", models: [{}, {}] })),
      ),
    );
    expect(await probeLocalSim("http://localhost:8000")).toEqual({
      ok: true,
      detail: "Reachable — sim 0.1.0 with 2 models.",
    });
  });

  it("reports dead endpoints honestly", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new TypeError("down"))),
    );
    const probe = await probeLocalSim("http://localhost:8999");
    expect(probe.ok).toBe(false);
    expect(probe.detail).toContain("No sim answers");
  });
});
