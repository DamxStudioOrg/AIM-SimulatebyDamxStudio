import { NextResponse } from "next/server";
import { postMatchStream } from "@/lib/sim";
import type { MatchRequest } from "@/lib/match-request";
import { isValidMatchRequest } from "@/lib/match-request";
import { bodyTooLarge, jsonTooLarge, SimApiError } from "@/lib/http";
import { SIM_START_HINT } from "@/lib/env";

/**
 * Streaming match proxy: validates like /api/match, then relays the
 * sim's SSE body untouched. A 404 means an older sim without the
 * stream endpoint — the client falls back to the blocking call.
 */
export async function POST(request: Request): Promise<Response> {
  if (bodyTooLarge(request.headers)) {
    return NextResponse.json({ error: "body too large" }, { status: 413 });
  }
  const raw: unknown = await request.json().catch(() => undefined);
  if (jsonTooLarge(raw)) {
    return NextResponse.json({ error: "body too large" }, { status: 413 });
  }
  if (!isValidMatchRequest(raw)) {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }
  const input: MatchRequest = raw;
  let upstream: Response;
  try {
    upstream = await postMatchStream(input.prompt, input.seed, input.model ?? "", {
      uid: input.uid,
      providerKey: input.providerKey,
      promptMaxWords: input.promptMaxWords,
      tokenBudget: input.tokenBudget,
      interventions: input.interventions,
      challengeParams: input.challenge_params,
      chaosLevel: input.chaosLevel,
    });
  } catch (err) {
    if (err instanceof SimApiError) {
      const body: Record<string, string> = { error: err.message };
      if (err.status >= 500) body.hint = SIM_START_HINT;
      return NextResponse.json(body, { status: err.status });
    }
    throw err;
  }
  if (upstream.status === 404) {
    return NextResponse.json({ error: "match stream not supported" }, { status: 404 });
  }
  if (!upstream.ok) {
    let detail = "sim API match request failed";
    try {
      const body: unknown = await upstream.json();
      if (typeof body === "object" && body !== null) {
        const error = (body as Record<string, unknown>).error;
        if (typeof error === "string") {
          detail = error;
        }
      }
    } catch {
      // Fall through with the generic detail.
    }
    return NextResponse.json({ error: detail }, { status: upstream.status });
  }
  return new Response(upstream.body, {
    status: 200,
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      connection: "keep-alive",
    },
  });
}
