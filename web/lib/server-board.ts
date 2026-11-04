/** Client for the Laravel live board. Offline-tolerant: null when down. */

import { TOTE_SCORE_PAR, toteNorm100 } from "./challenges";
import type { StrategyFingerprint } from "./sim";

export type BoardGame = "city" | "tote";
export type BoardMetric = "impact" | "efficiency" | "score";

export const METRICS_FOR: Record<BoardGame, BoardMetric[]> = {
  city: ["impact", "efficiency"],
  tote: ["score"],
};

export type BoardFamily = "llama" | "openai" | "anthropic" | "open" | "other";

export const FAMILY_LABELS: Record<BoardFamily, string> = {
  llama: "Llama",
  openai: "OpenAI",
  anthropic: "Anthropic",
  open: "Other open",
  other: "Other",
};

const OPEN_WEIGHTS = [
  "qwen",
  "deepseek",
  "mistral",
  "mixtral",
  "hermes",
  "gemma",
  "phi-",
  "falcon",
  "wizard",
];

/** Model family from the run's model id, falling back to the provider build. */
export function boardFamily(model: string, provider: string): BoardFamily {
  const haystack = `${model} ${provider}`.toLowerCase();
  if (haystack.includes("llama")) {
    return "llama";
  }
  if (haystack.includes("gpt") || haystack.includes("openai")) {
    return "openai";
  }
  if (haystack.includes("claude") || haystack.includes("anthropic")) {
    return "anthropic";
  }
  if (OPEN_WEIGHTS.some((name) => haystack.includes(name))) {
    return "open";
  }
  return "other";
}

export interface BoardRow {
  position: number;
  uid: string;
  game: BoardGame;
  challenge: string | null;
  seed: number;
  model: string;
  provider: string;
  nickname: string | null;
  badges: string[] | null;
  diversityPenalty: number;
  badgeBoost: number;
  value: number;
  createdAt: string | null;
}

/** Short badge labels for the board; unknown ids pass through. */
const BADGE_LABELS: Record<string, string> = {
  clean_sheet: "Clean sheet",
  full_coffers: "Full coffers",
  green_shift: "Green shift",
  light_pack: "Light pack",
  fragile_top3: "Fragile top 3",
  spotless: "Spotless",
};

/** Human-readable badge labels, in award order. */
export function badgeLabels(badges: string[] | null): string[] {
  if (badges === null) {
    return [];
  }
  return badges.map((badge) => BADGE_LABELS[badge] ?? badge);
}

/** Public bot name: nickname when set, else the short arena id. */
export function displayBotName(row: Pick<BoardRow, "nickname" | "uid">): string {
  if (row.nickname !== null && row.nickname.trim() !== "") {
    return row.nickname;
  }
  return row.uid.length <= 8 ? row.uid : `${row.uid.slice(0, 8)}…`;
}

export interface BoardPayload {
  board: BoardRow[];
  you: BoardRow | null;
}

/** Snapshot of the visible board for the stage analytics graph. */
export interface RankSnapshotRow {
  position: number;
  name: string;
  value: number;
  you: boolean;
}

export interface RanksSnapshot {
  /** "all" is the unified board across both simulation shifts. */
  game: BoardGame | "all";
  metric: BoardMetric;
  challenge: string;
  failed: boolean;
  rows: RankSnapshotRow[];
}

/** Sim-signed run receipt, forwarded verbatim to the board. */
export interface BoardReceipt {
  payload: string;
  sig: string;
}

export interface RunSubmission {
  uid: string;
  game: BoardGame;
  challenge?: string;
  seed: number;
  model: string;
  provider: string;
  nickname?: string;
  badges?: string[];
  strategy?: StrategyFingerprint | Record<string, unknown>;
  impact?: number;
  efficiency?: number;
  score?: number;
  details?: Record<string, unknown>;
  receipt?: BoardReceipt;
}

export interface SubmitResult {
  id: number;
  position: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function toRow(raw: unknown, game: BoardGame, metric: BoardMetric): BoardRow | null {
  if (!isRecord(raw)) {
    return null;
  }
  const {
    position,
    uid,
    challenge,
    seed,
    model,
    provider,
    nickname,
    badges,
    diversity_penalty,
    badge_boost,
    created_at,
  } = raw;
  const value = raw[metric];
  if (
    typeof position !== "number" ||
    typeof uid !== "string" ||
    raw.game !== game ||
    (challenge !== undefined && challenge !== null && typeof challenge !== "string") ||
    typeof seed !== "number" ||
    typeof model !== "string" ||
    typeof provider !== "string" ||
    (nickname !== undefined && nickname !== null && typeof nickname !== "string") ||
    (badges !== undefined &&
      badges !== null &&
      (!Array.isArray(badges) || badges.some((entry) => typeof entry !== "string"))) ||
    (diversity_penalty !== undefined &&
      diversity_penalty !== null &&
      typeof diversity_penalty !== "number") ||
    (badge_boost !== undefined &&
      badge_boost !== null &&
      typeof badge_boost !== "number") ||
    typeof value !== "number" ||
    (created_at !== null && typeof created_at !== "string")
  ) {
    return null;
  }
  return {
    position,
    uid,
    game,
    challenge: typeof challenge === "string" ? challenge : null,
    seed,
    model,
    provider,
    nickname: typeof nickname === "string" ? nickname : null,
    badges: Array.isArray(badges) ? (badges as string[]) : null,
    diversityPenalty: typeof diversity_penalty === "number" ? diversity_penalty : 0,
    badgeBoost: typeof badge_boost === "number" ? badge_boost : 0,
    value,
    createdAt: created_at,
  };
}

/** Record one scored run; resolves null when the board server is down. */
export async function submitRun(
  submission: RunSubmission,
): Promise<SubmitResult | null> {
  let response: Response;
  try {
    response = await fetch("/api/runs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(submission),
    });
  } catch {
    return null;
  }
  if (!response.ok) {
    return null;
  }
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return null;
  }
  if (
    !isRecord(body) ||
    typeof body.id !== "number" ||
    typeof body.position !== "number"
  ) {
    return null;
  }
  return { id: body.id, position: body.position };
}

export interface BoardOptions {
  uid?: string;
  limit?: number;
  challenge?: string;
}

/** Top runs for a game + metric; resolves null when the board is down. */
export async function fetchBoard(
  game: BoardGame,
  metric: BoardMetric,
  options?: BoardOptions,
): Promise<BoardPayload | null> {
  const params = new URLSearchParams({ game, metric });
  if (options?.limit !== undefined) {
    params.set("limit", String(options.limit));
  }
  if (options?.uid !== undefined) {
    params.set("uid", options.uid);
  }
  if (options?.challenge !== undefined && options.challenge !== "") {
    params.set("challenge", options.challenge);
  }
  let response: Response;
  try {
    response = await fetch(`/api/leaderboard?${params.toString()}`);
  } catch {
    return null;
  }
  if (!response.ok) {
    return null;
  }
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return null;
  }
  if (!isRecord(body) || !Array.isArray(body.board)) {
    return null;
  }
  const board: BoardRow[] = [];
  for (const raw of body.board) {
    const row = toRow(raw, game, metric);
    if (row === null) {
      return null;
    }
    board.push(row);
  }
  const you =
    body.you === null || body.you === undefined ? null : toRow(body.you, game, metric);
  if (body.you !== null && body.you !== undefined && you === null) {
    return null;
  }
  return { board, you };
}

function rankAmong(rows: BoardRow[], value: number): number {
  return 1 + rows.filter((row) => row.value > value).length;
}

/**
 * One simulation board across both shifts: city runs by impact,
 * tote pack scores carried onto the unified 0–100 scale, ranked
 * together. Positions re-derive here (server positions are
 * per-shift); ties break to the earlier run, then arena ID. The
 * signed-in `you` is the better-ranked of the two per-shift rows.
 * Null when either board is down — half a board is no board.
 */
export function mergeBoards(
  city: BoardPayload | null,
  tote: BoardPayload | null,
): BoardPayload | null {
  if (city === null || tote === null) {
    return null;
  }
  // Tote adjustments scale with the value so the ranked-score
  // decomposition (raw − penalty + boost) stays honest unified.
  const unify = 100 / TOTE_SCORE_PAR;
  const board = [
    ...city.board,
    ...tote.board.map((row) => ({
      ...row,
      value: toteNorm100(row.value),
      diversityPenalty: row.diversityPenalty * unify,
      badgeBoost: row.badgeBoost * unify,
    })),
  ]
    .sort((a, b) => {
      if (a.value !== b.value) {
        return b.value - a.value;
      }
      const aWhen = a.createdAt ?? "9999";
      const bWhen = b.createdAt ?? "9999";
      if (aWhen !== bWhen) {
        return aWhen < bWhen ? -1 : 1;
      }
      return a.uid < b.uid ? -1 : 1;
    })
    .map((row, index) => ({ ...row, position: index + 1 }));
  const candidates: BoardRow[] = [];
  if (city.you !== null) {
    candidates.push(city.you);
  }
  if (tote.you !== null) {
    candidates.push({ ...tote.you, value: toteNorm100(tote.you.value) });
  }
  let you: BoardRow | null = null;
  for (const candidate of candidates) {
    const placed: BoardRow = {
      ...candidate,
      position: rankAmong(board, candidate.value),
    };
    if (you === null || placed.position < you.position) {
      you = placed;
    }
  }
  return { board, you };
}
