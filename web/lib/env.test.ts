import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_LARAVEL_URL,
  DEFAULT_SIM_URL,
  isHttpBase,
  resolveEndpoints,
  resolveLaravelUrl,
  resolveSimEndpoints,
} from "./env";

describe("isHttpBase", () => {
  it("accepts absolute http(s) URLs with a host", () => {
    expect(isHttpBase("http://localhost:8000")).toBe(true);
    expect(isHttpBase("https://board.example.com/api")).toBe(true);
  });

  it("rejects schemes, relatives, and embedded credentials", () => {
    for (const bad of [
      "file:///etc/hosts",
      "javascript:alert(1)",
      "ftp://x.test/a",
      "/relative/path",
      "not a url",
      "",
      "http://",
      "http://user:pass@host.test/",
    ]) {
      expect(isHttpBase(bad)).toBe(false);
    }
  });
});

describe("resolveEndpoints", () => {
  it("drops non-http entries and falls back when none survive", () => {
    expect(
      resolveEndpoints(
        "file:///x, http://a.test, javascript:alert(1)",
        "http://d.test",
      ),
    ).toEqual(["http://a.test"]);
    expect(resolveEndpoints("file:///x, not-a-url", "http://d.test")).toEqual([
      "http://d.test",
    ]);
    expect(resolveEndpoints(undefined, "http://d.test")).toEqual(["http://d.test"]);
  });
});

describe("resolveSimEndpoints / resolveLaravelUrl", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("resolves configured http(s) endpoints", () => {
    vi.stubEnv("SIM_API_URL", "http://sim.test:8000, http://sim2.test:8000");
    vi.stubEnv("LARAVEL_URL", "https://board.test");
    expect(resolveSimEndpoints()).toEqual([
      "http://sim.test:8000",
      "http://sim2.test:8000",
    ]);
    expect(resolveLaravelUrl()).toBe("https://board.test");
  });

  it("falls back to loopback defaults on poisoned values", () => {
    vi.stubEnv("SIM_API_URL", "file:///etc/hosts");
    vi.stubEnv("LARAVEL_URL", "javascript:alert(1)");
    expect(resolveSimEndpoints()).toEqual([DEFAULT_SIM_URL]);
    expect(resolveLaravelUrl()).toBe(DEFAULT_LARAVEL_URL);
  });
});
