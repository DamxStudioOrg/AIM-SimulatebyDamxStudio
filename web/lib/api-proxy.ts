/**
 * Generic Next.js API route factory for sim / board proxies.
 * Reduces duplication of body guards, error mapping and hints.
 */

import { NextResponse } from "next/server";
import { bodyTooLarge, jsonTooLarge, LaravelError, SimApiError } from "@/lib/http";
import { SIM_START_HINT } from "@/lib/env";
import { LARAVEL_START_HINT } from "@/lib/env";

export type Handler<TIn, TOut> = (input: TIn) => Promise<TOut>;

export interface ProxyOptions {
  /** Validate input body, return false for 400 */
  validate?: (raw: unknown) => boolean;
  /** Optional uid validation */
  validateUid?: (uid?: string) => boolean;
  /** Map errors to NextResponse */
  errorMap?: (err: unknown) => NextResponse | null;
}

export function createProxy<TIn, TOut>({
  handler,
  validate,
  validateUid,
  errorMap,
}: {
  handler: Handler<TIn, TOut>;
  validate?: (raw: unknown) => boolean;
  validateUid?: (uid?: string) => boolean;
  errorMap?: (err: unknown) => NextResponse | null;
}): (request: Request) => Promise<NextResponse> {
  return async (request: Request): Promise<NextResponse> => {
    if (bodyTooLarge(request.headers)) {
      return NextResponse.json({ error: "body too large" }, { status: 413 });
    }
    const raw: unknown = await request.json().catch(() => undefined);
    if (jsonTooLarge(raw)) {
      return NextResponse.json({ error: "body too large" }, { status: 413 });
    }
    if (validate && !validate(raw)) {
      return NextResponse.json({ error: "invalid body" }, { status: 400 });
    }
    if (validateUid) {
      const rawUid =
        typeof raw === "object" && raw !== null
          ? (raw as Record<string, unknown>).uid
          : undefined;
      const uid = typeof rawUid === "string" ? rawUid : undefined;
      if (!validateUid(uid)) {
        return NextResponse.json(
          { error: "invalid identity payload" },
          { status: 400 },
        );
      }
    }
    try {
      const result = await handler(raw as TIn);
      return NextResponse.json(result);
    } catch (err) {
      if (errorMap) {
        const mapped = errorMap(err);
        if (mapped) return mapped;
      }
      throw err;
    }
  };
}

export function simErrorMap(err: unknown, hint = SIM_START_HINT) {
  if (err instanceof SimApiError) {
    const body: Record<string, string> = { error: err.message };
    if (err.status >= 500) body.hint = hint;
    return NextResponse.json(body, { status: err.status });
  }
  return null;
}

export function boardErrorMap(err: unknown, hint = LARAVEL_START_HINT) {
  if (err instanceof LaravelError) {
    const body: Record<string, string> = { error: err.message };
    if (err.status >= 500) body.hint = hint;
    return NextResponse.json(body, { status: err.status });
  }
  return null;
}
