import { afterEach, describe, expect, it, vi } from "vitest";
import { HISTORY_KEY, loadHistory } from "./history";
import type { HistoryEntry } from "./history";
import {
  COMPLETION_TOAST_MS,
  ackCompletion,
  clearSession,
  getStoreSnapshot,
  pendingCompletions,
  presentMatchReplay,
  presentPackReplay,
  startMatchRun,
  startPackRun,
  subscribeStore,
} from "./match-run-store";
import type {
  MatchRunRequest,
  PackRunRequest,
  RunProgressState,
} from "./match-run-store";
import { loadSealedText } from "./sealed-store";
import type { StorageLike } from "./sealed-store";
import type { MatchResultPayload, TotePackResult } from "./sim";

const UID = "test-arena-uid";

function fakeStorage(): StorageLike {
  const map = new Map<string, string>();
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => {
      map.set(key, value);
    },
    removeItem: (key: string) => {
      map.delete(key);
    },
  };
}

function useStorage(storage: StorageLike): void {
  vi.stubGlobal("window", { localStorage: storage });
}

async function sealedHistory(
  storage: StorageLike,
  uid: string,
): Promise<HistoryEntry[]> {
  const read = await loadSealedText(storage, HISTORY_KEY, uid);
  return loadHistory(read.text);
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function sseResponse(frames: unknown[]): Response {
  const body = frames.map((frame) => `data: ${JSON.stringify(frame)}\n\n`).join("");
  return new Response(body, {
    status: 200,
    headers: { "content-type": "text/event-stream" },
  });
}

function turnFrame(turn: number): unknown {
  return {
    type: "turn",
    turn,
    total: 2,
    tokens_used: 10,
    thinking_tokens: 0,
    skipped: false,
    impact: turn,
    efficiency: turn,
  };
}

function matchPayload(impact: number, seed = 1): MatchResultPayload {
  return {
    seed,
    provider: "probe",
    scores: { impact, efficiency: impact - 1 },
    totals: { tokens_used: 20 },
    loss_reasons: [],
    turns: [],
    badges: [],
    strategy: {
      mean_allocation: {},
      policies: {},
      played_turns: 2,
      skipped_turns: 0,
    },
    prompt_words: 5,
    token_budget: 100,
  };
}

function packPayload(score: number): TotePackResult {
  return {
    seed: 4,
    provider: "probe",
    uid: UID,
    offered: ["rope"],
    packing: ["rope"],
    value: 3,
    damage: { overweight: 0, crush: 0, stain: 0, cut: 0, total: 0 },
    score,
    totals: { tokens_used: 9 },
    invalid_reason: null,
    scarce: [],
    wildcards: [],
    badges: [],
    bonus: 0,
    usage_anomaly: false,
  };
}

function matchRequest(overrides?: Partial<MatchRunRequest>): MatchRunRequest {
  return {
    prompt: "tend the groves",
    seed: 1,
    model: "local/probe",
    uid: UID,
    interventions: [],
    challenge: undefined,
    specs: [{ label: "", seed: 1, chaosLevel: undefined }],
    turnsTotal: 2,
    assets: null,
    ...overrides,
  };
}

function packRequest(overrides?: Partial<PackRunRequest>): PackRunRequest {
  return {
    prompt: "stack it tight",
    seed: 4,
    model: "local/probe",
    uid: UID,
    ...overrides,
  };
}

async function waitForBoard(kind: "match" | "pack"): Promise<number | null> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const position = getStoreSnapshot()[kind].boardPosition;
    if (position !== null) {
      return position;
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  return getStoreSnapshot()[kind].boardPosition;
}

async function flushAsync(): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("completion notice rules", () => {
  it("keeps the popup dwell at seven seconds", () => {
    expect(COMPLETION_TOAST_MS).toBe(7000);
  });

  it("stays quiet while idle", () => {
    clearSession("match");
    clearSession("pack");
    expect(pendingCompletions(getStoreSnapshot())).toEqual([]);
  });

  it("never notifies for replays", () => {
    presentMatchReplay(matchPayload(42), null);
    presentPackReplay(packPayload(80));
    expect(pendingCompletions(getStoreSnapshot())).toEqual([]);
  });
});

describe("match runs", () => {
  it("streams turns, settles the best, and records history", async () => {
    const storage = fakeStorage();
    useStorage(storage);
    const seen: (RunProgressState | null)[] = [];
    const stop = subscribeStore(() => {
      seen.push(getStoreSnapshot().match.progress);
    });
    try {
      const payload = matchPayload(42);
      vi.stubGlobal(
        "fetch",
        vi.fn((url: string) => {
          if (url === "/api/runs") {
            return Promise.resolve(jsonResponse({ id: 9, position: 3 }));
          }
          return Promise.resolve(
            sseResponse([
              turnFrame(1),
              turnFrame(2),
              { type: "result", result: payload },
            ]),
          );
        }),
      );
      await startMatchRun(matchRequest());
      const session = getStoreSnapshot().match;
      expect(session.status).toBe("done");
      expect(session.result).toEqual(payload);
      expect(session.variants).toBeNull();
      expect(session.error).toBeNull();
      expect(session.progress).toBeNull();
      expect(seen.some((entry) => entry?.turn === 1)).toBe(true);
      expect(seen.some((entry) => entry?.turn === 2)).toBe(true);
      const entries = await sealedHistory(storage, UID);
      expect(entries).toHaveLength(1);
      expect(entries[0]?.impact).toBe(42);
      expect(entries[0]?.prompt).toBe("tend the groves");
      expect(await waitForBoard("match")).toBe(3);
      expect(getStoreSnapshot().match.boardPosition).toBe(3);
    } finally {
      stop();
    }
  });

  it("forwards the sim receipt when submitting the best run", async () => {
    useStorage(fakeStorage());
    const submitted: unknown[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string, init?: { body?: unknown }) => {
        if (url === "/api/runs") {
          const raw = init?.body;
          submitted.push(JSON.parse(typeof raw === "string" ? raw : "null") as unknown);
          return Promise.resolve(jsonResponse({ id: 9, position: 3 }));
        }
        return Promise.resolve(
          sseResponse([
            {
              type: "result",
              result: {
                ...matchPayload(42),
                receipt: { payload: "match-proof", sig: "match-sig" },
              },
            },
          ]),
        );
      }),
    );
    await startMatchRun(matchRequest());
    expect(await waitForBoard("match")).toBe(3);
    expect(submitted).toHaveLength(1);
    expect(submitted[0]).toMatchObject({
      uid: UID,
      receipt: { payload: "match-proof", sig: "match-sig" },
    });
  });

  it("publishes a completion notice for an away player to ack", async () => {
    useStorage(fakeStorage());
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) => {
        if (url === "/api/runs") {
          return Promise.resolve(jsonResponse({ id: 1, position: 1 }));
        }
        return Promise.resolve(
          sseResponse([{ type: "result", result: matchPayload(61) }]),
        );
      }),
    );
    await startMatchRun(matchRequest());
    const found = pendingCompletions(getStoreSnapshot());
    expect(found).toHaveLength(1);
    expect(found[0]?.kind).toBe("match");
    expect(found[0]?.status).toBe("done");
    expect(found[0]?.title).toBe("Simulation complete");
    expect(found[0]?.detail).toContain("61");
    const seq = found[0]?.seq ?? -1;
    ackCompletion("match", seq + 1000);
    expect(pendingCompletions(getStoreSnapshot())).toHaveLength(1);
    ackCompletion("match", seq);
    expect(pendingCompletions(getStoreSnapshot())).toEqual([]);
  });

  it("falls back to the blocking call on a 404 stream", async () => {
    useStorage(fakeStorage());
    const seen: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) => {
        seen.push(url);
        if (url === "/api/runs") {
          return Promise.resolve(jsonResponse({ id: 1, position: 1 }));
        }
        if (url === "/api/match-stream") {
          return Promise.resolve(new Response("gone", { status: 404 }));
        }
        return Promise.resolve(jsonResponse(matchPayload(15)));
      }),
    );
    await startMatchRun(matchRequest());
    expect(getStoreSnapshot().match.result?.scores.impact).toBe(15);
    expect(seen).toContain("/api/match");
  });

  it("maps a provider failure to the retry hint", async () => {
    useStorage(fakeStorage());
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(sseResponse([{ type: "error", error: "boom" }]))),
    );
    const first = startMatchRun(matchRequest());
    const joined = startMatchRun(matchRequest());
    expect(joined).toBe(first);
    await first;
    await joined;
    const session = getStoreSnapshot().match;
    expect(session.status).toBe("error");
    expect(session.error).toBe("boom");
    const found = pendingCompletions(getStoreSnapshot());
    expect(found[0]?.title).toBe("Simulation failed");
  });

  it("plays every variant and keeps the best by impact", async () => {
    useStorage(fakeStorage());
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string, init?: RequestInit) => {
        if (url === "/api/runs") {
          return Promise.resolve(jsonResponse({ id: 1, position: 1 }));
        }
        const rawBody = init?.body;
        const bodyText = typeof rawBody === "string" ? rawBody : "{}";
        const body = JSON.parse(bodyText) as { seed?: unknown };
        const seed = typeof body.seed === "number" ? body.seed : 0;
        const payload = matchPayload(seed === 7 ? 10 : 50, seed);
        return Promise.resolve(sseResponse([{ type: "result", result: payload }]));
      }),
    );
    await startMatchRun(
      matchRequest({
        seed: 7,
        specs: [
          { label: "Seed 7", seed: 7, chaosLevel: undefined },
          { label: "Seed 8", seed: 8, chaosLevel: undefined },
        ],
      }),
    );
    const session = getStoreSnapshot().match;
    expect(session.result?.scores.impact).toBe(50);
    expect(session.variants?.map((entry) => entry.label)).toEqual(["Seed 7", "Seed 8"]);
  });

  it("keeps a late receipt off a newer run", async () => {
    const storage = fakeStorage();
    useStorage(storage);
    const gates: ((response: Response) => void)[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) => {
        if (url === "/api/runs") {
          return new Promise<Response>((resolve) => {
            gates.push(resolve);
          });
        }
        return Promise.resolve(
          sseResponse([{ type: "result", result: matchPayload(20) }]),
        );
      }),
    );
    await startMatchRun(matchRequest());
    await startMatchRun(matchRequest());
    expect(gates).toHaveLength(2);
    gates[0]?.(jsonResponse({ id: 1, position: 3 }));
    await flushAsync();
    expect(getStoreSnapshot().match.boardPosition).toBeNull();
    gates[1]?.(jsonResponse({ id: 2, position: 5 }));
    expect(await waitForBoard("match")).toBe(5);
    const entries = await sealedHistory(storage, UID);
    expect(entries.find((entry) => entry.boardPosition === 3)).toBeUndefined();
    expect(entries.find((entry) => entry.boardPosition === 5)).toBeDefined();
  });
});

describe("tote packs", () => {
  it("packs, records, and reports the score", async () => {
    const storage = fakeStorage();
    useStorage(storage);
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) => {
        if (url === "/api/runs") {
          return Promise.resolve(jsonResponse({ id: 4, position: 2 }));
        }
        return Promise.resolve(jsonResponse(packPayload(88)));
      }),
    );
    await startPackRun(packRequest());
    const session = getStoreSnapshot().pack;
    expect(session.status).toBe("done");
    expect(session.result?.score).toBe(88);
    expect(session.startedAt).toBeNull();
    const entries = await sealedHistory(storage, UID);
    expect(entries).toHaveLength(1);
    expect(entries[0]?.game).toBe("tote");
    expect(entries[0]?.score).toBe(88);
    expect(await waitForBoard("pack")).toBe(2);
    const found = pendingCompletions(getStoreSnapshot());
    const pack = found.find((entry) => entry.kind === "pack");
    expect(pack?.title).toBe("Tote pack complete");
    expect(pack?.detail).toContain("88");
  });

  it("forwards the sim receipt when submitting the pack", async () => {
    useStorage(fakeStorage());
    const submitted: unknown[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string, init?: { body?: unknown }) => {
        if (url === "/api/runs") {
          const raw = init?.body;
          submitted.push(JSON.parse(typeof raw === "string" ? raw : "null") as unknown);
          return Promise.resolve(jsonResponse({ id: 4, position: 2 }));
        }
        return Promise.resolve(
          jsonResponse({
            ...packPayload(88),
            receipt: { payload: "pack-proof", sig: "pack-sig" },
          }),
        );
      }),
    );
    await startPackRun(packRequest());
    expect(await waitForBoard("pack")).toBe(2);
    expect(submitted).toHaveLength(1);
    expect(submitted[0]).toMatchObject({
      uid: UID,
      receipt: { payload: "pack-proof", sig: "pack-sig" },
    });
  });

  it("publishes pack rejections as errors", async () => {
    useStorage(fakeStorage());
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(jsonResponse({ error: "pack broke" }, 422))),
    );
    await startPackRun(packRequest());
    const session = getStoreSnapshot().pack;
    expect(session.status).toBe("error");
    expect(session.error).toBe("pack broke");
  });
});

describe("session controls", () => {
  it("orders completions newest first across kinds", async () => {
    useStorage(fakeStorage());
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) => {
        if (url === "/api/runs") {
          return Promise.resolve(jsonResponse({ id: 1, position: 1 }));
        }
        if (url === "/api/tote") {
          return Promise.resolve(jsonResponse(packPayload(70)));
        }
        return Promise.resolve(
          sseResponse([{ type: "result", result: matchPayload(33) }]),
        );
      }),
    );
    await startMatchRun(matchRequest());
    await startPackRun(packRequest());
    const found = pendingCompletions(getStoreSnapshot());
    expect(found.map((entry) => entry.kind)).toEqual(["pack", "match"]);
  });

  it("never clears a running session", async () => {
    useStorage(fakeStorage());
    const releases: ((response: Response) => void)[] = [];
    const gate = new Promise<Response>((resolve) => {
      releases.push(resolve);
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(() => gate),
    );
    const flight = startPackRun(packRequest());
    clearSession("pack");
    expect(getStoreSnapshot().pack.status).toBe("running");
    releases[0]?.(jsonResponse(packPayload(50)));
    await flight;
    const token = getStoreSnapshot().pack.token;
    clearSession("pack");
    const session = getStoreSnapshot().pack;
    expect(session.status).toBe("idle");
    expect(session.result).toBeNull();
    expect(session.token).toBe(token);
  });
});
