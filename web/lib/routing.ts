/**
 * Centralised route and link definitions.
 * Use these constants instead of hard-coded href strings.
 */

export const ROUTES = {
  home: "/",
  docs: "/docs",
  console: "/console",
  ranks: "/ranks",
  prompts: "/prompts",
  account: "/account",
} as const;

export type RouteKey = keyof typeof ROUTES;

export function link(key: RouteKey, params?: Record<string, string | number>) {
  const path = ROUTES[key];
  if (!params) return path;
  const qs = Object.entries(params)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
    .join("&");
  return qs ? `${path}?${qs}` : path;
}

/** API route names for internal use */
export const API = {
  match: "/api/match",
  runs: "/api/runs",
  leaderboard: "/api/leaderboard",
  tote: "/api/tote",
  proposals: "/api/proposals",
  assets: "/api/assets",
  contract: "/api/contract",
} as const;
