import { afterEach, describe, expect, it, vi } from "vitest";
import {
  badgeLabels,
  boardFamily,
  displayBotName,
  fetchBoard,
  mergeBoards,
  submitRun,
} from "./server-board";
import type { BoardPayload, BoardRow } from "./server-board";

afterEach(() => {
  vi.unstubAllGlobals();
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("submitRun", () => {
  it("returns the server rank position on success", async () => {
    const fetch = vi.fn(() =>
      Promise.resolve(jsonResponse({ id: 7, position: 2 }, 201)),
    );
    vi.stubGlobal("fetch", fetch);

    const result = await submitRun({
      uid: "arena-1",
      game: "city",
      seed: 8,
      model: "ollama/llama3.1",
      provider: "ollama:llama3.1",
      impact: 3.5,
      efficiency: 0.4,
    });

    expect(result).toEqual({ id: 7, position: 2 });
    expect(fetch).toHaveBeenCalledWith(
      "/api/runs",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("returns null when the board server is unreachable", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new TypeError("offline"))),
    );

    const result = await submitRun({
      uid: "arena-1",
      game: "tote",
      seed: 3,
      model: "ollama/llama3.1",
      provider: "ollama:llama3.1",
      score: 7.5,
    });

    expect(result).toBeNull();
  });
});

describe("fetchBoard", () => {
  it("normalizes rows to the ranked value and keeps your row", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(
          jsonResponse({
            board: [
              {
                position: 1,
                uid: "arena-high",
                game: "city",
                seed: 8,
                model: "ollama/llama3.1",
                provider: "ollama:llama3.1",
                impact: 5.0,
                created_at: "2026-10-27T00:00:00Z",
              },
            ],
            you: {
              position: 2,
              uid: "arena-mid",
              game: "city",
              seed: 8,
              model: "ollama/llama3.1",
              provider: "ollama:llama3.1",
              impact: 3.0,
              created_at: null,
            },
          }),
        ),
      ),
    );

    const payload = await fetchBoard("city", "impact", { uid: "arena-mid" });

    expect(payload?.board).toHaveLength(1);
    expect(payload?.board[0]).toMatchObject({
      position: 1,
      uid: "arena-high",
      value: 5.0,
    });
    expect(payload?.you).toMatchObject({ position: 2, value: 3.0 });
  });

  it("returns null on malformed board payloads", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(jsonResponse({ board: [42] }))),
    );

    await expect(fetchBoard("tote", "score")).resolves.toBeNull();
  });

  it("parses nicknames and tolerates legacy rows without them", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(
          jsonResponse({
            board: [
              {
                position: 1,
                uid: "arena-named",
                game: "city",
                seed: 8,
                model: "m",
                provider: "p",
                nickname: "Rusty",
                impact: 5.0,
                created_at: null,
              },
              {
                position: 2,
                uid: "arena-legacy",
                game: "city",
                seed: 8,
                model: "m",
                provider: "p",
                impact: 4.0,
                created_at: null,
              },
            ],
          }),
        ),
      ),
    );

    const payload = await fetchBoard("city", "impact");
    expect(payload?.board[0]?.nickname).toBe("Rusty");
    expect(payload?.board[1]?.nickname).toBeNull();
  });

  it("parses badges and tolerates legacy rows without them", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(
          jsonResponse({
            board: [
              {
                position: 1,
                uid: "arena-badged",
                game: "tote",
                seed: 3,
                model: "m",
                provider: "p",
                badges: ["spotless", "light_pack"],
                score: 9.5,
                created_at: null,
              },
              {
                position: 2,
                uid: "arena-legacy",
                game: "tote",
                seed: 3,
                model: "m",
                provider: "p",
                score: 4.0,
                created_at: null,
              },
            ],
          }),
        ),
      ),
    );

    const payload = await fetchBoard("tote", "score");
    expect(payload?.board[0]?.badges).toEqual(["spotless", "light_pack"]);
    expect(payload?.board[1]?.badges).toBeNull();
  });

  it("rejects rows with malformed badges", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(
          jsonResponse({
            board: [
              {
                position: 1,
                uid: "arena-1",
                game: "tote",
                seed: 3,
                model: "m",
                provider: "p",
                badges: "spotless",
                score: 9.5,
                created_at: null,
              },
            ],
          }),
        ),
      ),
    );

    await expect(fetchBoard("tote", "score")).resolves.toBeNull();
  });

  it("parses challenge scope and ranking adjustments", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(
          jsonResponse({
            board: [
              {
                position: 1,
                uid: "arena-1",
                game: "city",
                challenge: "debut",
                seed: 1,
                model: "m",
                provider: "p",
                diversity_penalty: 0.5,
                badge_boost: 0.25,
                impact: 9.5,
                created_at: null,
              },
              {
                position: 2,
                uid: "arena-2",
                game: "city",
                seed: 1,
                model: "m",
                provider: "p",
                impact: 9.0,
                created_at: null,
              },
            ],
          }),
        ),
      ),
    );

    const payload = await fetchBoard("city", "impact");
    expect(payload?.board[0]?.challenge).toBe("debut");
    expect(payload?.board[0]?.diversityPenalty).toBe(0.5);
    expect(payload?.board[0]?.badgeBoost).toBe(0.25);
    expect(payload?.board[1]?.challenge).toBeNull();
    expect(payload?.board[1]?.diversityPenalty).toBe(0);
    expect(payload?.board[1]?.badgeBoost).toBe(0);
  });

  it("sends the challenge scope when set", async () => {
    const fetch = vi.fn(() => Promise.resolve(jsonResponse({ board: [], you: null })));
    vi.stubGlobal("fetch", fetch);

    await fetchBoard("city", "impact", { challenge: "debut" });
    expect(fetch).toHaveBeenCalledWith(
      "/api/leaderboard?game=city&metric=impact&challenge=debut",
    );

    await fetchBoard("city", "impact", { challenge: "" });
    expect(fetch).toHaveBeenLastCalledWith("/api/leaderboard?game=city&metric=impact");
  });
});

describe("badgeLabels", () => {
  it("labels known badges and passes unknown ids through", () => {
    expect(badgeLabels(["clean_sheet", "mystery"])).toEqual(["Clean sheet", "mystery"]);
    expect(badgeLabels(null)).toEqual([]);
  });
});

describe("displayBotName", () => {
  it("prefers nicknames over ids", () => {
    expect(displayBotName({ nickname: "Rusty", uid: "arena-1" })).toBe("Rusty");
  });

  it("falls back to the short id for blank or missing nicknames", () => {
    expect(displayBotName({ nickname: null, uid: "arena-123456789" })).toBe(
      "arena-12…",
    );
    expect(displayBotName({ nickname: "  ", uid: "arena-1" })).toBe("arena-1");
  });
});

describe("boardFamily", () => {
  it("spots Llama in ids and provider builds", () => {
    expect(boardFamily("ollama/llama3.1", "ollama:llama3.1")).toBe("llama");
    expect(boardFamily("baseten/meta-llama/Llama-3-1-8B", "litellm")).toBe("llama");
    expect(boardFamily("custom-name", "ollama:llama3.1")).toBe("llama");
  });

  it("spots closed and other open families", () => {
    expect(boardFamily("gpt-4o-mini", "litellm")).toBe("openai");
    expect(boardFamily("claude-3-haiku", "litellm")).toBe("anthropic");
    expect(boardFamily("local/hermes3", "local:hermes3")).toBe("open");
    expect(boardFamily("mystery-model", "litellm")).toBe("other");
  });
});

describe("mergeBoards", () => {
  function row(overrides: Partial<BoardRow>): BoardRow {
    return {
      position: 1,
      uid: "11111111-2222-4333-8444-555555555555",
      game: "city",
      challenge: null,
      seed: 7,
      model: "ollama/llama3.1",
      provider: "ollama:llama3.1",
      nickname: null,
      badges: null,
      diversityPenalty: 0,
      badgeBoost: 0,
      value: 50,
      createdAt: "2026-10-01T00:00:00.000Z",
      ...overrides,
    };
  }

  it("ranks both shifts on one scale, tote normalized to 0-100", () => {
    const city: BoardPayload = {
      board: [row({ uid: "a", value: 60 }), row({ uid: "b", value: 40 })],
      you: null,
    };
    const tote: BoardPayload = {
      board: [
        row({ uid: "c", game: "tote", value: 22.5 }), // 50 unified
        row({ uid: "d", game: "tote", value: 45 }), // 100 unified
      ],
      you: null,
    };
    const merged = mergeBoards(city, tote);
    expect(merged?.board.map((entry) => entry.uid)).toEqual(["d", "a", "c", "b"]);
    expect(merged?.board.map((entry) => entry.position)).toEqual([1, 2, 3, 4]);
  });

  it("places the signed-in row as the better of the two shifts", () => {
    const city: BoardPayload = {
      board: [row({ uid: "a", value: 60 })],
      you: row({ uid: "me", value: 55 }),
    };
    const tote: BoardPayload = {
      board: [row({ uid: "b", game: "tote", value: 45 })],
      you: row({ uid: "me", game: "tote", value: 40.5 }), // 90 unified
    };
    const merged = mergeBoards(city, tote);
    expect(merged?.you?.game).toBe("tote");
    expect(merged?.you?.value).toBe(90);
    expect(merged?.you?.position).toBe(2);
  });

  it("is null when either shift board is down", () => {
    const payload: BoardPayload = { board: [], you: null };
    expect(mergeBoards(null, payload)).toBeNull();
    expect(mergeBoards(payload, null)).toBeNull();
    expect(mergeBoards(payload, payload)).toEqual({ board: [], you: null });
  });
});
