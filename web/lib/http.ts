/**
 * Shared HTTP client utilities for sim and board.
 * Server-side only.
 */

import { resolveSimEndpoints, resolveLaravelUrl, simToken } from "./env";

export class SimApiError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "SimApiError";
    this.status = status;
  }
}

export class LaravelError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "LaravelError";
    this.status = status;
  }
}

function simHeaders(init?: RequestInit): Record<string, string> {
  const headers: Record<string, string> = {};
  if (init?.headers !== undefined) {
    for (const [key, value] of new Headers(init.headers).entries()) {
      headers[key] = value;
    }
  }
  const token = simToken();
  if (token) {
    headers["x-sim-token"] = token;
  }
  return headers;
}

async function tryFetch(url: string, init?: RequestInit): Promise<Response | null> {
  try {
    return await fetch(url, init);
  } catch {
    return null;
  }
}

/**
 * Fetch from sim with comma-list fallback. Retries on 502/503/504 except last.
 */
export async function simFetch(path: string, init?: RequestInit): Promise<Response> {
  const urls = resolveSimEndpoints();
  let lastStatus = 503;
  for (const base of urls) {
    const res = await tryFetch(`${base}${path}`, {
      ...init,
      headers: simHeaders(init),
    });
    if (!res) continue;
    if (
      (res.status === 502 || res.status === 503 || res.status === 504) &&
      base !== urls[urls.length - 1]
    ) {
      lastStatus = res.status;
      continue;
    }
    return res;
  }
  throw new SimApiError(lastStatus, `sim API unreachable at ${urls.join(", ")}`);
}

/**
 * Simple board fetch, no fallback list.
 */
export async function boardFetch(path: string, init?: RequestInit): Promise<Response> {
  const url = `${resolveLaravelUrl()}${path}`;
  try {
    return await fetch(url, init);
  } catch {
    throw new LaravelError(503, `board API unreachable at ${resolveLaravelUrl()}`);
  }
}

/**
 * JSON read helper for sim client.
 */
export async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    throw new SimApiError(
      response.status,
      `sim API returned status ${String(response.status)}`,
    );
  }
}

/**
 * JSON read helper for board client.
 */
export async function readBoardJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    throw new LaravelError(
      response.status,
      `board API returned status ${String(response.status)}`,
    );
  }
}

/**
 * Body size guards reused by API routes.
 */
export function bodyTooLarge(headers: Headers): boolean {
  const len = headers.get("content-length");
  return len !== null && Number(len) > 2 * 1024 * 1024;
}

export function jsonTooLarge(value: unknown): boolean {
  try {
    const s = JSON.stringify(value);
    return s.length > 2 * 1024 * 1024;
  } catch {
    return true;
  }
}
