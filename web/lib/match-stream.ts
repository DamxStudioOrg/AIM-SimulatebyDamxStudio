import { simFailureMessage } from "./sim";
import type { MatchResultPayload } from "./sim";

/** One settled turn inside a streamed match. */
export interface StreamTurn {
  turn: number;
  total: number;
  tokensUsed: number;
  thinkingTokens: number;
  skipped: boolean;
  impact: number;
  efficiency: number;
}

/** The stream ended without a result, or a frame was unreadable. */
export class StreamError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StreamError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function asTurn(value: unknown): StreamTurn | null {
  if (!isRecord(value) || value.type !== "turn") {
    return null;
  }
  const { turn, total, tokensUsed, thinkingTokens, skipped, impact, efficiency } = {
    turn: value.turn,
    total: value.total,
    tokensUsed: value.tokens_used,
    thinkingTokens: value.thinking_tokens,
    skipped: value.skipped,
    impact: value.impact,
    efficiency: value.efficiency,
  };
  if (
    typeof turn !== "number" ||
    !Number.isInteger(turn) ||
    typeof total !== "number" ||
    !Number.isInteger(total) ||
    typeof tokensUsed !== "number" ||
    typeof skipped !== "boolean" ||
    typeof impact !== "number" ||
    typeof efficiency !== "number"
  ) {
    return null;
  }
  return {
    turn,
    total,
    tokensUsed,
    thinkingTokens: typeof thinkingTokens === "number" ? thinkingTokens : 0,
    skipped,
    impact,
    efficiency,
  };
}

/**
 * Read a match SSE stream to its result, reporting each turn. Frames
 * arrive as `data: {...}` separated by blank lines; a `result` frame
 * resolves with the same payload the blocking call returns, and an
 * `error` frame rejects with the sim's message. Unknown frames are
 * ignored so old clients survive new event kinds.
 */
export async function readMatchStream(
  response: Response,
  onTurn: (turn: StreamTurn) => void,
): Promise<MatchResultPayload> {
  if (response.body === null) {
    throw new StreamError("match stream had no body");
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      buffer += decoder.decode(value, { stream: true });
      let cut = buffer.indexOf("\n\n");
      while (cut !== -1) {
        const frame = buffer.slice(0, cut);
        buffer = buffer.slice(cut + 2);
        const outcome = handleFrame(frame, onTurn);
        if (outcome !== undefined) {
          return outcome;
        }
        cut = buffer.indexOf("\n\n");
      }
    }
  } finally {
    reader.releaseLock();
  }
  const tail = buffer.trim();
  if (tail !== "") {
    const outcome = handleFrame(tail, onTurn);
    if (outcome !== undefined) {
      return outcome;
    }
  }
  throw new StreamError("match stream ended without a result");
}

function handleFrame(
  frame: string,
  onTurn: (turn: StreamTurn) => void,
): MatchResultPayload | undefined {
  const lines = frame
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("data:"));
  if (lines.length === 0) {
    return undefined;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(lines.map((line) => line.slice(5).trim()).join("\n"));
  } catch {
    throw new StreamError("match stream sent an unreadable frame");
  }
  if (!isRecord(parsed) || typeof parsed.type !== "string") {
    return undefined;
  }
  if (parsed.type === "turn") {
    const turn = asTurn(parsed);
    if (turn === null) {
      throw new StreamError("match stream sent a bad turn frame");
    }
    onTurn(turn);
    return undefined;
  }
  if (parsed.type === "result") {
    if (!isRecord(parsed.result)) {
      throw new StreamError("match stream sent a bad result frame");
    }
    return parsed.result as unknown as MatchResultPayload;
  }
  if (parsed.type === "error") {
    const cause =
      isRecord(parsed) && typeof parsed.reason === "string"
        ? simFailureMessage(parsed.reason)
        : null;
    if (cause !== null) {
      throw new StreamError(cause);
    }
    const detail =
      isRecord(parsed) && typeof parsed.error === "string" ? parsed.error : null;
    throw new StreamError(detail ?? "match failed");
  }
  return undefined;
}
