/**
 * Local-sim failover for browsers. Every sim call tries the hosted Next
 * proxy first; on a dead proxy (network error or a 502/503/504 from a
 * missing sim behind it) the call retries directly against the player's
 * own sim endpoint. The route is indicator state: proxy success always
 * flips back, so recovery needs no manual step.
 */
import { simFailureMessage, simRejectionMessage } from "./sim";

export const LOCAL_SIM_KEY = "aim-local-sim";
export const DEFAULT_LOCAL_SIM = "http://localhost:8000";

export type SimRoute = "proxy" | "direct";

let route: SimRoute = "proxy";
const listeners = new Set<() => void>();

export function getSimRoute(): SimRoute {
  return route;
}

export function subscribeSimRoute(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function setSimRoute(next: SimRoute): void {
  if (next === route) {
    return;
  }
  route = next;
  for (const listener of listeners) {
    listener();
  }
}

function normalizeEndpoint(value: string): string | null {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return null;
  }
  if (url.hostname === "") {
    return null;
  }
  return url.origin;
}

export function loadLocalSim(): string {
  try {
    const saved = window.localStorage.getItem(LOCAL_SIM_KEY);
    return saved ?? DEFAULT_LOCAL_SIM;
  } catch {
    return DEFAULT_LOCAL_SIM;
  }
}

/** Persist a local sim endpoint; false when the value is not http(s). */
export function saveLocalSim(value: string): boolean {
  const endpoint = normalizeEndpoint(value);
  if (endpoint === null) {
    return false;
  }
  try {
    window.localStorage.setItem(LOCAL_SIM_KEY, endpoint);
  } catch {
    return false;
  }
  return true;
}

function isSimDown(status: number): boolean {
  return status === 502 || status === 503 || status === 504;
}

async function readBody(response: Response): Promise<unknown> {
  try {
    return (await response.json()) as unknown;
  } catch {
    return null;
  }
}

export interface SimCallSpec {
  path: string;
  init?: RequestInit;
  /** Model id for human-readable direct rejections. */
  model?: string;
}

/** Both the proxy and the local endpoint failed the same call. */
export class SimRouteError extends Error {
  constructor(endpoint: string) {
    super(`sim unreachable via proxy and ${endpoint}`);
    this.name = "SimRouteError";
  }
}

/**
 * Run one sim call through the proxy, falling back to the local sim
 * endpoint when the proxy path is dead. Semantic failures (4xx) never
 * fail over — only a dead proxy does.
 */
export async function fetchSimCall(
  proxy: SimCallSpec,
  direct: SimCallSpec,
): Promise<Response> {
  let proxyResponse: Response | null = null;
  try {
    proxyResponse = await fetch(proxy.path, proxy.init);
  } catch {
    // A dead proxy keeps proxyResponse null so the local endpoint is tried below.
  }
  if (proxyResponse !== null && !isSimDown(proxyResponse.status)) {
    setSimRoute("proxy");
    return proxyResponse;
  }
  const endpoint = loadLocalSim();
  let directResponse: Response;
  try {
    directResponse = await fetch(`${endpoint}${direct.path}`, direct.init);
  } catch {
    if (proxyResponse !== null) {
      return proxyResponse;
    }
    throw new SimRouteError(endpoint);
  }
  setSimRoute("direct");
  if (directResponse.ok) {
    return directResponse;
  }
  // Normalize raw sim errors into the {error} shape callers already read.
  const raw: unknown = await readBody(directResponse);
  if (directResponse.status === 422) {
    const message = simRejectionMessage(raw, direct.model ?? "");
    return new Response(JSON.stringify({ error: message }), {
      status: directResponse.status,
      headers: { "content-type": "application/json" },
    });
  }
  const bare = `local sim request failed (status ${String(directResponse.status)})`;
  const record =
    typeof raw === "object" && raw !== null
      ? (raw as Record<string, unknown>)
      : undefined;
  const nested =
    typeof record?.detail === "object" && record.detail !== null
      ? (record.detail as Record<string, unknown>)
      : undefined;
  const cause = simFailureMessage(nested?.reason ?? record?.reason);
  const message = cause === null ? bare : `${bare}: ${cause}`;
  return new Response(JSON.stringify({ error: message }), {
    status: directResponse.status,
    headers: { "content-type": "application/json" },
  });
}

/**
 * Open one streaming sim call through the proxy, falling back to the
 * local sim endpoint when the proxy path is dead. Same routing as
 * fetchSimCall, but the body is never touched: the caller reads the
 * live stream, so even error responses pass through raw.
 */
export async function fetchSimCallStream(
  proxy: SimCallSpec,
  direct: SimCallSpec,
): Promise<Response> {
  let proxyResponse: Response | null = null;
  try {
    proxyResponse = await fetch(proxy.path, proxy.init);
  } catch {
    // A dead proxy keeps proxyResponse null so the local endpoint is tried below.
  }
  if (proxyResponse !== null && !isSimDown(proxyResponse.status)) {
    setSimRoute("proxy");
    return proxyResponse;
  }
  const endpoint = loadLocalSim();
  let directResponse: Response;
  try {
    directResponse = await fetch(`${endpoint}${direct.path}`, direct.init);
  } catch {
    if (proxyResponse !== null) {
      return proxyResponse;
    }
    throw new SimRouteError(endpoint);
  }
  setSimRoute("direct");
  return directResponse;
}

export interface SimProbe {
  ok: boolean;
  detail: string;
}

/** Check a local sim endpoint without touching the route. */
export async function probeLocalSim(endpoint: string): Promise<SimProbe> {
  let response: Response;
  try {
    response = await fetch(`${endpoint}/contract`, { cache: "no-store" });
  } catch {
    return { ok: false, detail: `No sim answers at ${endpoint}.` };
  }
  if (!response.ok) {
    return { ok: false, detail: `Sim answered status ${String(response.status)}.` };
  }
  const body: unknown = await readBody(response);
  if (typeof body !== "object" || body === null) {
    return { ok: false, detail: "Sim answered with a bad contract." };
  }
  const record = body as Record<string, unknown>;
  const version = typeof record.sim_version === "string" ? record.sim_version : "?";
  const models = Array.isArray(record.models) ? record.models.length : 0;
  return {
    ok: true,
    detail: `Reachable — sim ${version} with ${String(models)} models.`,
  };
}
