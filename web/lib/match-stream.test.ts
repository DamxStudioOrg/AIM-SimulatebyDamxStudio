import { describe, expect, it } from "vitest";

import { StreamError, readMatchStream } from "./match-stream";
import type { StreamTurn } from "./match-stream";

function turnFrame(turn: number, total = 12): string {
  return `data: ${JSON.stringify({
    type: "turn",
    turn,
    total,
    tokens_used: 100,
    skipped: false,
    impact: 40 + turn,
    efficiency: 5,
  })}\n\n`;
}

function resultFrame(): string {
  return `data: ${JSON.stringify({
    type: "result",
    result: { seed: 1, scores: { impact: 62, efficiency: 8 } },
  })}\n\n`;
}

/** A Response whose body arrives in the given chunks. */
function chunkedResponse(chunks: string[]): Response {
  const bytes = chunks.map((chunk) => new TextEncoder().encode(chunk));
  let index = 0;
  const reader = {
    read: (): Promise<{ done: boolean; value?: Uint8Array }> => {
      if (index >= bytes.length) {
        return Promise.resolve({ done: true, value: undefined });
      }
      const value = bytes[index];
      index += 1;
      return Promise.resolve({ done: false, value });
    },
    releaseLock: (): void => undefined,
  };
  return {
    body: { getReader: () => reader },
  } as unknown as Response;
}

describe("readMatchStream", () => {
  it("reports turns in order and resolves with the result", async () => {
    const seen: StreamTurn[] = [];
    const payload = await readMatchStream(
      chunkedResponse([turnFrame(1), turnFrame(2), resultFrame()]),
      (turn) => {
        seen.push(turn);
      },
    );
    expect(seen.map((turn) => turn.turn)).toEqual([1, 2]);
    expect(seen[0]).toEqual({
      turn: 1,
      total: 12,
      tokensUsed: 100,
      thinkingTokens: 0,
      skipped: false,
      impact: 41,
      efficiency: 5,
    });
    expect(payload).toEqual({ seed: 1, scores: { impact: 62, efficiency: 8 } });
  });

  it("reassembles frames split across chunks", async () => {
    const body = `${turnFrame(1)}${resultFrame()}`;
    const seen: StreamTurn[] = [];
    const payload = await readMatchStream(
      chunkedResponse([body.slice(0, 17), body.slice(17, 55), body.slice(55)]),
      (turn) => {
        seen.push(turn);
      },
    );
    expect(seen.map((turn) => turn.turn)).toEqual([1]);
    expect(payload).toEqual({ seed: 1, scores: { impact: 62, efficiency: 8 } });
  });

  it("carries thinking tokens, defaulting to zero", async () => {
    const seen: StreamTurn[] = [];
    await readMatchStream(
      chunkedResponse([
        `data: ${JSON.stringify({ type: "turn", turn: 1, total: 2, tokens_used: 100, thinking_tokens: 250, skipped: false, impact: 41, efficiency: 5 })}\n\n`,
        turnFrame(2, 2),
        resultFrame(),
      ]),
      (turn) => {
        seen.push(turn);
      },
    );
    expect(seen.map((turn) => turn.thinkingTokens)).toEqual([250, 0]);
  });

  it("ignores unknown frames and comments", async () => {
    const seen: StreamTurn[] = [];
    const payload = await readMatchStream(
      chunkedResponse([
        `: keep-alive\n\n${turnFrame(1)}data: ${JSON.stringify({ type: "future", n: 1 })}\n\n${resultFrame()}`,
      ]),
      (turn) => {
        seen.push(turn);
      },
    );
    expect(seen).toHaveLength(1);
    expect(payload).toEqual({ seed: 1, scores: { impact: 62, efficiency: 8 } });
  });

  it("rejects honestly on error frames, bad frames, and cut streams", async () => {
    await expect(
      readMatchStream(
        chunkedResponse([
          `data: ${JSON.stringify({ type: "error", error: "provider_failed" })}\n\n`,
        ]),
        () => undefined,
      ),
    ).rejects.toThrow("provider_failed");

    await expect(
      readMatchStream(
        chunkedResponse([
          `data: ${JSON.stringify({ type: "error", error: "provider_failed", reason: "model_missing" })}\n\n`,
        ]),
        () => undefined,
      ),
    ).rejects.toThrow("does not have that model loaded");

    await expect(
      readMatchStream(chunkedResponse(["data: {nope}\n\n"]), () => undefined),
    ).rejects.toThrow(StreamError);

    await expect(
      readMatchStream(chunkedResponse([turnFrame(1)]), () => undefined),
    ).rejects.toThrow("ended without a result");

    await expect(
      readMatchStream({ body: null } as unknown as Response, () => undefined),
    ).rejects.toThrow("no body");
  });
});
