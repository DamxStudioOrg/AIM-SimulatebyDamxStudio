import { NextResponse } from "next/server";
import { LARAVEL_START_HINT, LaravelError, getBoard } from "@/lib/laravel";
import { METRICS_FOR } from "@/lib/server-board";
import type { BoardGame, BoardMetric } from "@/lib/server-board";
import { isValidUid } from "@/lib/vault";

function isGame(value: string | null): value is BoardGame {
  return value === "city" || value === "tote";
}

/** Live board read: ranks move with every posted run. */
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<NextResponse> {
  const params = new URL(request.url).searchParams;
  const game = params.get("game");
  const metric = params.get("metric");
  const limitText = params.get("limit");
  const uid = params.get("uid");
  if (!isGame(game)) {
    return NextResponse.json({ error: "query needs game=city|tote" }, { status: 400 });
  }
  const allowed: BoardMetric[] = METRICS_FOR[game];
  if (metric === null || !allowed.includes(metric as BoardMetric)) {
    return NextResponse.json(
      { error: `query needs metric=${allowed.join("|")} for ${game}` },
      { status: 400 },
    );
  }
  let limit: number | undefined;
  if (limitText !== null) {
    limit = Number.parseInt(limitText, 10);
    if (!Number.isInteger(limit) || limit < 1 || limit > 50) {
      return NextResponse.json(
        { error: "limit must be an integer from 1 to 50" },
        { status: 400 },
      );
    }
  }
  if (uid !== null && !isValidUid(uid)) {
    return NextResponse.json(
      { error: "uid must be a valid arena id" },
      { status: 400 },
    );
  }
  const challenge = params.get("challenge");
  if (challenge !== null && (challenge === "" || challenge.length > 64)) {
    return NextResponse.json(
      { error: "challenge must be a non-empty id of at most 64 chars" },
      { status: 400 },
    );
  }
  try {
    const board = await getBoard({
      game,
      metric,
      limit,
      uid: uid ?? undefined,
      challenge: challenge ?? undefined,
    });
    return NextResponse.json(board);
  } catch (error) {
    if (error instanceof LaravelError) {
      const body: Record<string, string> = { error: error.message };
      if (error.status >= 500) {
        body.hint = LARAVEL_START_HINT;
      }
      return NextResponse.json(body, { status: error.status });
    }
    throw error;
  }
}
