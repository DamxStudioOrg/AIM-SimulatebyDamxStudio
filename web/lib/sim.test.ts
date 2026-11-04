import { afterEach, describe, expect, it, vi } from "vitest";
import {
  draftAssets,
  getContract,
  getToteCatalog,
  getToteOffer,
  resolveSimUrl,
  resolveSimUrls,
  runMatch,
  runTotePack,
} from "./sim";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const KEY = "SIM_API_URL";

describe("sim client unreachable mapping", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("defaults to localhost:8000 when SIM_API_URL is empty", () => {
    expect(resolveSimUrl(undefined)).toBe("http://localhost:8000");
    expect(resolveSimUrl("")).toBe("http://localhost:8000");
    expect(resolveSimUrl("http://sim:8000")).toBe("http://sim:8000");
  });

  it("maps a refused connection to 503", async () => {
    vi.stubEnv(KEY, "http://127.0.0.1:9");
    await expect(getContract()).rejects.toMatchObject({ status: 503 });
  });
});

describe("sim endpoint fallback", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("parses a comma-separated cloud-first list", () => {
    expect(resolveSimUrls("https://sim.example.com, http://localhost:8000")).toEqual([
      "https://sim.example.com",
      "http://localhost:8000",
    ]);
    expect(resolveSimUrls(undefined)).toEqual(["http://localhost:8000"]);
    expect(resolveSimUrls("  ")).toEqual(["http://localhost:8000"]);
    expect(resolveSimUrl("https://sim.example.com,http://localhost:8000")).toBe(
      "https://sim.example.com",
    );
  });

  it("falls through to the next endpoint on network failure", async () => {
    vi.stubEnv(KEY, "http://127.0.0.1:9,http://127.0.0.1:10");
    const seen: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) => {
        seen.push(url);
        if (seen.length === 1) {
          return Promise.reject(new Error("refused"));
        }
        return Promise.resolve(jsonResponse({ sim_version: "0.1.0" }));
      }),
    );

    const contract = await getContract();
    expect(contract.sim_version).toBe("0.1.0");
    expect(seen).toEqual([
      "http://127.0.0.1:9/contract",
      "http://127.0.0.1:10/contract",
    ]);
  });

  it("reports 503 only when every endpoint fails", async () => {
    vi.stubEnv(KEY, "http://127.0.0.1:9,http://127.0.0.1:10");
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new Error("refused"))),
    );
    await expect(getContract()).rejects.toMatchObject({ status: 503 });
  });

  it("does not fall through on authoritative client errors", async () => {
    vi.stubEnv(KEY, "http://127.0.0.1:9,http://127.0.0.1:10");
    const fetch = vi.fn(() => Promise.resolve(jsonResponse({}, 422)));
    vi.stubGlobal("fetch", fetch);
    await expect(getContract()).rejects.toMatchObject({ status: 422 });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("forwards the cloud token when set", async () => {
    vi.stubEnv(KEY, "http://127.0.0.1:9");
    vi.stubEnv("SIM_API_TOKEN", "s3cret");
    const seen: (RequestInit | undefined)[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn((_url: string, init?: RequestInit) => {
        seen.push(init);
        return Promise.resolve(jsonResponse({ sim_version: "0.1.0" }));
      }),
    );
    await getContract();
    expect(seen[0]?.headers).toMatchObject({ "x-sim-token": "s3cret" });
  });
});

describe("tote client", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("fetches the catalog with item weights", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(
          jsonResponse({
            capacity_kg: 10,
            items: [
              {
                id: "hammer",
                label: "Claw hammer",
                weight: 1.2,
                value: 6,
                fragile: false,
                tags: [],
              },
            ],
          }),
        ),
      ),
    );

    const catalog = await getToteCatalog();
    expect(catalog.capacity_kg).toBe(10);
    expect(catalog.items[0]).toMatchObject({ id: "hammer", weight: 1.2 });
  });

  it("fetches the seeded offer", async () => {
    const fetch = vi.fn(() =>
      Promise.resolve(jsonResponse({ seed: 4, capacity_kg: 10, offered: ["hammer"] })),
    );
    vi.stubGlobal("fetch", fetch);

    const offer = await getToteOffer(4);
    expect(offer.offered).toEqual(["hammer"]);
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining("/tote/offer?seed=4"),
      expect.anything(),
    );
  });

  it("maps a missing hosted key to a connect hint", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(jsonResponse({ error: "missing_key" }, 422))),
    );

    await expect(runTotePack("pack", 4, "gpt-4o-mini")).rejects.toMatchObject({
      status: 422,
    });
  });
});

describe("match client", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("forwards per-run limits to the sim", async () => {
    const fetchMock = vi.fn<typeof fetch>(() =>
      Promise.resolve(jsonResponse({ seed: 9, scores: {}, totals: {}, turns: [] })),
    );
    vi.stubGlobal("fetch", fetchMock);

    await runMatch("Hold reserves.", 9, "local/test", {
      promptMaxWords: 120,
      tokenBudget: 6000,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = fetchMock.mock.calls[0]?.[1]?.body;
    expect(typeof body).toBe("string");
    const sent = JSON.parse(body as string) as Record<string, unknown>;
    expect(sent.prompt_max_words).toBe(120);
    expect(sent.token_budget).toBe(6000);
  });

  it("forwards the field plan to the sim", async () => {
    const fetchMock = vi.fn<typeof fetch>(() =>
      Promise.resolve(jsonResponse({ seed: 9, scores: {}, totals: {}, turns: [] })),
    );
    vi.stubGlobal("fetch", fetchMock);

    await runMatch("Hold reserves.", 9, "local/test", {
      interventions: [{ turn: 5, kind: "irrigate" }],
    });
    const body = fetchMock.mock.calls[0]?.[1]?.body;
    const sent = JSON.parse(body as string) as Record<string, unknown>;
    expect(sent.interventions).toEqual([{ turn: 5, kind: "irrigate" }]);
  });

  it("forwards the chaos level only when set", async () => {
    const fetchMock = vi.fn<typeof fetch>(() =>
      Promise.resolve(jsonResponse({ seed: 9, scores: {}, totals: {}, turns: [] })),
    );
    vi.stubGlobal("fetch", fetchMock);

    await runMatch("Hold reserves.", 9, "local/test", { chaosLevel: 0.5 });
    const sent = JSON.parse(fetchMock.mock.calls[0]?.[1]?.body as string) as Record<
      string,
      unknown
    >;
    expect(sent.chaos_level).toBe(0.5);

    await runMatch("Hold reserves.", 9, "local/test", {});
    const quiet = JSON.parse(fetchMock.mock.calls[1]?.[1]?.body as string) as Record<
      string,
      unknown
    >;
    expect("chaos_level" in quiet).toBe(false);
  });

  it("forwards asset drafts to the sim", async () => {
    const fetchMock = vi.fn<typeof fetch>(() =>
      Promise.resolve(jsonResponse({ params: { version: 1 }, tokens_used: 41 })),
    );
    vi.stubGlobal("fetch", fetchMock);

    await draftAssets("An ember moon.", "local/test", { uid: "u-1" });
    const init = fetchMock.mock.calls[0]?.[1];
    expect(fetchMock.mock.calls[0]?.[0]).toContain("/assets/draft");
    const sent = JSON.parse(init?.body as string) as Record<string, unknown>;
    expect(sent.prompt).toBe("An ember moon.");
    expect(sent.model).toBe("local/test");
    expect(sent.uid).toBe("u-1");
  });

  it("surfaces invalid-draft details", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(
          jsonResponse(
            { detail: { error: "invalid_draft", detail: "model did not return JSON" } },
            422,
          ),
        ),
      ),
    );

    await expect(draftAssets("An ember moon.", "local/test")).rejects.toMatchObject({
      status: 422,
      message: "model did not return valid dressing: model did not return JSON",
    });
  });

  it("reads nested FastAPI rejection codes", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(jsonResponse({ detail: { error: "bad_limits" } }, 422)),
      ),
    );

    await expect(runMatch("Hold reserves.", 9, "local/test")).rejects.toMatchObject({
      status: 422,
      message: "match limits must be positive integers within the sim's caps",
    });
  });
});
