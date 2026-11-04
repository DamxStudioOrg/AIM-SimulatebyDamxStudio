/**
 * Centralised environment configuration for sim and board endpoints.
 * Server-side only.
 */

export const DEFAULT_SIM_URL = "http://localhost:8000";
export const DEFAULT_LARAVEL_URL = "http://localhost:8001";

export const SIM_START_HINT =
  "Start it with `cd sim && ../.venv/bin/uvicorn aim_sim.api:create_app --factory --port 8000` (needs `pip install -e .[api]` in sim/), or set SIM_API_URL to a running sim.";

export const LARAVEL_START_HINT =
  "Start it with `cd server && php artisan serve --port=8001`, or set LARAVEL_URL to a running board server.";

/**
 * True for absolute http(s) URLs with a host and no embedded
 * credentials. Non-http schemes (file:, javascript:, …) never
 * reach server-side fetch, even from a poisoned environment.
 */
export function isHttpBase(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return false;
  }
  if (url.username !== "" || url.password !== "") {
    return false;
  }
  return url.hostname !== "";
}

/**
 * Resolve a comma-separated list of endpoints, first non-empty entry used for single-url helpers.
 */
export function resolveEndpoints(raw: string | undefined, fallback: string): string[] {
  if (!raw) return [fallback];
  const urls = raw
    .split(",")
    .map((e) => e.trim())
    .filter((e) => e !== "" && isHttpBase(e));
  return urls.length ? urls : [fallback];
}

export function resolveSimEndpoints(): string[] {
  return resolveEndpoints(process.env.SIM_API_URL, DEFAULT_SIM_URL);
}

export function resolveSimUrl(): string {
  return (
    resolveEndpoints(process.env.SIM_API_URL, DEFAULT_SIM_URL)[0] ?? DEFAULT_SIM_URL
  );
}

export function resolveLaravelUrl(): string {
  const raw = process.env.LARAVEL_URL;
  if (raw !== undefined && raw.trim() !== "" && isHttpBase(raw.trim())) {
    return raw.trim();
  }
  return DEFAULT_LARAVEL_URL;
}

export function simToken(): string | undefined {
  const t = process.env.SIM_API_TOKEN;
  return t && t !== "" ? t : undefined;
}
