import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { API_RATE_LIMIT, checkRateLimit } from "./lib/rate-limit";

// Public landing-only builds (NEXT_PUBLIC_LANDING_ONLY=1) serve the
// marketing page and nothing else: the console and every sim API route
// answer 404. The Electron shell and local dev run with the flag off,
// so the full console and its /api/* proxy chain keep working there.
const LANDING_ONLY = process.env.NEXT_PUBLIC_LANDING_ONLY === "1";

/**
 * One bucket map per server process. X-Forwarded-For is spoofable,
 * so this stops accidents and runaway loops, not a spoofed flood —
 * the sim and board keep their own limits behind the proxies.
 */
const apiBuckets = new Map<string, number[]>();

function clientKey(request: NextRequest): string {
  const forwarded = request.headers.get("x-forwarded-for");
  const first = forwarded?.split(",")[0]?.trim();
  if (first !== undefined && first !== "") {
    return `api:${first}`;
  }
  return "api:direct";
}

export function middleware(request?: NextRequest): NextResponse {
  if (LANDING_ONLY) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const pathname = request?.nextUrl.pathname ?? "";
  if (!pathname.startsWith("/api/")) {
    return NextResponse.next();
  }
  if (request !== undefined) {
    const verdict = checkRateLimit(
      apiBuckets,
      clientKey(request),
      Date.now(),
      API_RATE_LIMIT,
    );
    if (!verdict.allowed) {
      return NextResponse.json(
        { error: "rate limited, retry shortly" },
        {
          status: 429,
          headers: { "retry-after": String(verdict.retryAfterSec) },
        },
      );
    }
  }
  // Proxy answers are live sim/board reads: never heuristic-cache.
  const response = NextResponse.next();
  response.headers.set("cache-control", "no-store");
  return response;
}

export const config = {
  matcher: ["/console/:path*", "/api/:path*"],
};
