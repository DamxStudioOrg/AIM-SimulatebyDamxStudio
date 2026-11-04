import { NextResponse } from "next/server";
import { SIM_START_HINT, SimApiError, getContract } from "@/lib/sim";

/** Live sim read: never serve a statically cached contract. */
export const dynamic = "force-dynamic";

export async function GET(): Promise<NextResponse> {
  try {
    const contract = await getContract();
    return NextResponse.json(contract);
  } catch (error) {
    if (error instanceof SimApiError) {
      const body: Record<string, string> = { error: error.message };
      if (error.status >= 500) {
        body.hint = SIM_START_HINT;
      }
      return NextResponse.json(body, { status: error.status });
    }
    throw error;
  }
}
