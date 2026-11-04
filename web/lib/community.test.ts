import { afterEach, describe, expect, it, vi } from "vitest";
import {
  fetchProposals,
  latestReceiptForUid,
  proposeProposal,
  voteProposal,
} from "./community";

afterEach(() => {
  vi.unstubAllGlobals();
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function proposal(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 3,
    uid: "arena-1",
    nickname: "Rusty",
    title: "Blackout drill",
    description: "A heatwave knocks out clinics.",
    model: "ollama/hermes3:8b",
    input_prompt: "Keep the lights on.",
    output_format: "JSON allocations",
    restrictions: null,
    votes: 2,
    weighted_votes: 2.5,
    featured: false,
    created_at: "2026-10-29T00:00:00.000Z",
    ...overrides,
  };
}

describe("fetchProposals", () => {
  it("returns the board list", async () => {
    const fetch = vi.fn(() =>
      Promise.resolve(jsonResponse({ proposals: [proposal()] })),
    );
    vi.stubGlobal("fetch", fetch);

    const list = await fetchProposals();

    expect(list).toHaveLength(1);
    expect(list?.[0]?.title).toBe("Blackout drill");
    expect(fetch).toHaveBeenCalledWith("/api/proposals");
  });

  it("drops malformed rows but keeps good ones", async () => {
    const fetch = vi.fn(() =>
      Promise.resolve(jsonResponse({ proposals: [proposal(), { bogus: true }] })),
    );
    vi.stubGlobal("fetch", fetch);

    expect(await fetchProposals()).toHaveLength(1);
  });

  it("is null when the board is down", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new TypeError("offline"))),
    );

    expect(await fetchProposals()).toBeNull();
  });
});

describe("offline guards", () => {
  it("refuses to propose or vote without fetching", async () => {
    // Node's navigator is an accessor global that unstubAllGlobals cannot
    // restore, so save and replace the descriptor by hand.
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, "navigator");
    Object.defineProperty(globalThis, "navigator", {
      value: { onLine: false },
      configurable: true,
    });
    try {
      const fetch = vi.fn(() => Promise.reject(new Error("must not fetch")));
      vi.stubGlobal("fetch", fetch);

      const draft = {
        uid: "arena-1",
        title: "t",
        description: "d",
        model: "m",
        input_prompt: "i",
        output_format: "f",
      };
      expect(await proposeProposal(draft)).toEqual({
        ok: false,
        error: "You're offline — reconnect to propose.",
      });
      expect(await voteProposal(3, "arena-1")).toEqual({
        ok: false,
        error: "You're offline — reconnect to vote.",
      });
      expect(fetch).not.toHaveBeenCalled();
    } finally {
      if (descriptor === undefined) {
        delete (globalThis as Record<string, unknown>).navigator;
      } else {
        Object.defineProperty(globalThis, "navigator", descriptor);
      }
    }
  });
});

describe("proposeProposal", () => {
  const draft = {
    uid: "arena-1",
    title: "Blackout drill",
    description: "A heatwave knocks out clinics.",
    model: "ollama/hermes3:8b",
    input_prompt: "Keep the lights on.",
    output_format: "JSON allocations",
  };

  it("returns the created proposal", async () => {
    const fetch = vi.fn(() => Promise.resolve(jsonResponse(proposal(), 201)));
    vi.stubGlobal("fetch", fetch);

    const result = await proposeProposal(draft);

    expect(result).toEqual({ ok: true, value: proposal() });
    expect(fetch).toHaveBeenCalledWith(
      "/api/proposals",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("surfaces the board rejection reason", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(jsonResponse({ error: "Slow down." }, 429))),
    );

    const result = await proposeProposal(draft);

    expect(result).toEqual({ ok: false, error: "Slow down." });
  });
});

describe("voteProposal", () => {
  it("returns the weighted receipt", async () => {
    const fetch = vi.fn(() =>
      Promise.resolve(
        jsonResponse({ weight: 1.5, base: 1, badges: 2, top3: false }, 201),
      ),
    );
    vi.stubGlobal("fetch", fetch);

    const result = await voteProposal(3, "arena-1");

    expect(result).toEqual({
      ok: true,
      value: { weight: 1.5, base: 1, badges: 2, top3: false },
    });
    expect(fetch).toHaveBeenCalledWith(
      "/api/proposals/3/votes",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("surfaces unranked and duplicate rejections", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(jsonResponse({ error: "Play a match before voting." }, 422)),
      ),
    );
    expect(await voteProposal(3, "arena-new")).toEqual({
      ok: false,
      error: "Play a match before voting.",
    });

    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(
          jsonResponse({ error: "Already voted for this proposal." }, 409),
        ),
      ),
    );
    expect(await voteProposal(3, "arena-1")).toEqual({
      ok: false,
      error: "Already voted for this proposal.",
    });
  });

  it("forwards a sim receipt when the voter ran first", async () => {
    const fetch = vi.fn(() =>
      Promise.resolve(
        jsonResponse({ weight: 1, base: 1, badges: 0, top3: false }, 201),
      ),
    );
    vi.stubGlobal("fetch", fetch);

    await voteProposal(3, "arena-1", { payload: "p", sig: "s" });

    expect(fetch).toHaveBeenCalledWith(
      "/api/proposals/3/votes",
      expect.objectContaining({
        body: JSON.stringify({
          uid: "arena-1",
          receipt: { payload: "p", sig: "s" },
        }),
      }),
    );
  });
});

describe("latestReceiptForUid", () => {
  it("returns the newest receipt for one uid", () => {
    const history = [
      {
        when: "2026-11-03T00:00:02Z",
        seed: 2,
        provider: "local",
        game: "city",
        impact: 5,
        efficiency: 4,
        prompt: "",
        uid: "arena-1",
        result: {
          seed: 2,
          provider: "local",
          turns: [],
          receipt: { payload: "new", sig: "new-sig" },
        },
      },
      {
        when: "2026-11-03T00:00:01Z",
        seed: 1,
        provider: "local",
        game: "city",
        impact: 3,
        efficiency: 2,
        prompt: "",
        uid: "arena-1",
        result: {
          seed: 1,
          provider: "local",
          turns: [],
          receipt: { payload: "old", sig: "old-sig" },
        },
      },
    ] as never;
    expect(latestReceiptForUid(history, "arena-1")).toEqual({
      payload: "new",
      sig: "new-sig",
    });
  });

  it("returns null when the uid never ran", () => {
    const history = [
      {
        when: "2026-11-03T00:00:01Z",
        seed: 1,
        provider: "local",
        game: "city",
        impact: 3,
        efficiency: 2,
        prompt: "",
        uid: "arena-1",
      },
    ] as never;
    expect(latestReceiptForUid(history, "arena-2")).toBeNull();
    expect(latestReceiptForUid(history, "arena-1")).toBeNull();
  });
});
