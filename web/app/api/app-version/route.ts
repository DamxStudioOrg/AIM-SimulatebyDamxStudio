import { NextResponse } from "next/server";
import { boardVersion } from "@/lib/laravel";
import { LARAVEL_START_HINT, LaravelError } from "@/lib/laravel";

/** Live board read: update checks must see the shipped release. */
export const dynamic = "force-dynamic";

export async function GET(): Promise<NextResponse> {
  try {
    const board = await boardVersion();
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
