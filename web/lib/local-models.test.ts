import { afterEach, describe, expect, it, vi } from "vitest";
import { loopbackBase, probeLmStudio, probeModels } from "./local-models";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("loopbackBase", () => {
  it.each([
    "http://localhost:1234/v1",
    "http://localhost:1234/v1/",
    "http://127.0.0.1:11434/v1",
    "http://[::1]:1234/v1",
    "https://localhost:1234/v1",
  ])("accepts %s", (raw) => {
    expect(loopbackBase(raw)).toMatch(/^https?:\/\//);
  });

  it.each([
    "http://example.com/v1",
    "http://192.168.1.2:1234/v1",
    "http://10.0.0.5/v1",
    "http://localhost.evil.com/v1",
    "file:///etc/passwd",
    "not a url",
    "",
  ])("rejects %s", (raw) => {
    expect(loopbackBase(raw)).toBeNull();
  });

  it("strips the trailing slash", () => {
    expect(loopbackBase("http://localhost:1234/v1/")).toBe("http://localhost:1234/v1");
  });
});

describe("probeModels", () => {
  function stubFetch(impl: () => Promise<Response>): void {
    vi.stubGlobal("fetch", vi.fn(impl));
  }

  function jsonResponse(body: unknown, status = 200): Response {
    return {
      ok: status >= 200 && status < 300,
      status,
      json: () => Promise.resolve(body),
    } as Response;
  }

  it("lists ids from the standard shape", async () => {
    stubFetch(() =>
      Promise.resolve(jsonResponse({ data: [{ id: "a" }, { id: "b" }, {}] })),
    );
    const source = await probeModels("LM Studio", "http://localhost:1234/v1");
    expect(source.ok).toBe(true);
    expect(source.models).toEqual(["a", "b"]);
    expect(source.error).toBeNull();
  });

  it("reports unreachable runtimes honestly", async () => {
    stubFetch(() => Promise.reject(new Error("down")));
    const source = await probeModels("Ollama", "http://localhost:11434/v1");
    expect(source.ok).toBe(false);
    expect(source.models).toEqual([]);
    expect(source.error).toMatch(/unreachable/);
  });

  it.each([
    ["http status", jsonResponse({}, 500), /status 500/],
    [
      "non-JSON",
      { ok: true, status: 200, json: () => Promise.reject(new Error("x")) },
      /non-JSON/,
    ],
    ["missing data", jsonResponse({ models: [] }), /data\[\]/],
  ])("reports %s honestly", async (_label, response, pattern) => {
    stubFetch(() => Promise.resolve(response as Response));
    const source = await probeModels("LM Studio", "http://localhost:1234/v1");
    expect(source.ok).toBe(false);
    expect(source.error).toMatch(pattern);
  });
});

describe("probeLmStudio", () => {
  function stubFetch(impl: (url: string) => Promise<Response>): void {
    vi.stubGlobal("fetch", vi.fn(impl));
  }

  function jsonResponse(body: unknown, status = 200): Response {
    return {
      ok: status >= 200 && status < 300,
      status,
      json: () => Promise.resolve(body),
    } as Response;
  }

  it("falls through to the 1235 instance when 1234 is down", async () => {
    // The regression: LM Studio bound to the next port must still
    // auto-connect instead of reporting no local models.
    stubFetch((url) =>
      url.includes("1235")
        ? Promise.resolve(jsonResponse({ data: [{ id: "hermes-4-70b" }] }))
        : Promise.reject(new Error("down")),
    );
    const source = await probeLmStudio();
    expect(source.ok).toBe(true);
    expect(source.base).toBe("http://localhost:1235/v1");
    expect(source.models).toEqual(["hermes-4-70b"]);
  });

  it("prefers 1234 when both answer", async () => {
    stubFetch(() => Promise.resolve(jsonResponse({ data: [{ id: "stock" }] })));
    const source = await probeLmStudio();
    expect(source.base).toBe("http://localhost:1234/v1");
  });

  it("reports the first failure when every port is down", async () => {
    stubFetch(() => Promise.reject(new Error("down")));
    const source = await probeLmStudio();
    expect(source.ok).toBe(false);
    expect(source.base).toBe("http://localhost:1234/v1");
    expect(source.error).toMatch(/unreachable/);
  });
});
