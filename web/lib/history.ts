/** Per-browser run history, shared by the console and the landing page. */
import type { ChallengeAssets } from "./asset-schema";
import type { FieldIntervention } from "./field-plan";
import type { MatchResultPayload, TotePackResult } from "./sim";

export type HistoryGame = "city" | "tote";

export interface HistoryEntry {
  when: string;
  seed: number;
  provider: string;
  prompt: string;
  uid?: string;
  /** Which simulation recorded this entry; absent on legacy rows means city. */
  game?: HistoryGame;
  /** City summary metrics. */
  impact?: number;
  efficiency?: number;
  /** Tote summary metrics. */
  score?: number;
  damage?: number;
  packed?: number;
  /** Full recorded run for stage replay; absent on entries saved before replays. */
  result?: MatchResultPayload | TotePackResult;
  /** Model id that played the run, when known. */
  model?: string;
  /** Field plan the run carried; absent when the steward filed none. */
  plan?: FieldIntervention[];
  /** Stage dressing the run carried; absent for undressed trials. */
  assets?: ChallengeAssets;
  /** Live-board position receipt, when the board answered the submission. */
  boardPosition?: number | null;
}

export const HISTORY_KEY = "aim-arena-history";
export const MAX_HISTORY_ENTRIES = 20;

/** The simulation an entry belongs to; legacy rows without one are matches. */
export function entryGame(entry: HistoryEntry): HistoryGame {
  return entry.game === "tote" ? "tote" : "city";
}

/** Display date for a stored run; falls back to the raw value when invalid. */
export function formatHistoryWhen(when: string): string {
  const date = new Date(when);
  return Number.isNaN(date.getTime()) ? when : date.toLocaleString();
}

function isMatchReplay(value: unknown): value is MatchResultPayload {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.seed === "number" &&
    typeof candidate.provider === "string" &&
    Array.isArray(candidate.turns)
  );
}

function isPackReplay(value: unknown): value is TotePackResult {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.seed === "number" &&
    typeof candidate.provider === "string" &&
    Array.isArray(candidate.packing) &&
    typeof candidate.score === "number"
  );
}

function cleanEntry(entry: HistoryEntry): HistoryEntry {
  const saved = (entry as unknown as Record<string, unknown>).prompt;
  const result = (entry as unknown as Record<string, unknown>).result;
  const game = entryGame(entry);
  const fixed: HistoryEntry = {
    ...entry,
    game,
    prompt: typeof saved === "string" ? saved : "",
  };
  const replayOk =
    result === undefined ||
    (game === "tote" ? isPackReplay(result) : isMatchReplay(result));
  if (!replayOk) {
    delete fixed.result;
  }
  return fixed;
}

function hasGameMetric(candidate: Record<string, unknown>): boolean {
  if (candidate.game === "tote") {
    return typeof candidate.score === "number";
  }
  return typeof candidate.impact === "number";
}

export function loadHistory(raw: string | null): HistoryEntry[] {
  if (raw === null) {
    return [];
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed
      .filter(
        (entry): entry is HistoryEntry =>
          typeof entry === "object" &&
          entry !== null &&
          hasGameMetric(entry as Record<string, unknown>),
      )
      .map(cleanEntry);
  } catch {
    return [];
  }
}

function entryKey(entry: HistoryEntry): string {
  return `${entryGame(entry)}|${entry.when}|${String(entry.seed)}|${entry.provider}`;
}

function isHistoryEntry(entry: unknown): entry is HistoryEntry {
  if (typeof entry !== "object" || entry === null) {
    return false;
  }
  const candidate = entry as Record<string, unknown>;
  const base =
    typeof candidate.when === "string" &&
    typeof candidate.seed === "number" &&
    typeof candidate.provider === "string";
  if (!base) {
    return false;
  }
  if (candidate.game === "tote") {
    return typeof candidate.score === "number";
  }
  return (
    typeof candidate.impact === "number" && typeof candidate.efficiency === "number"
  );
}

/** Merge imported runs into local history: newest first, capped, deduped. */
export function mergeHistories(
  local: HistoryEntry[],
  incoming: HistoryEntry[],
): HistoryEntry[] {
  const seen = new Set(local.map(entryKey));
  const merged = [...local];
  for (const entry of incoming) {
    if (!isHistoryEntry(entry)) {
      continue;
    }
    if (!seen.has(entryKey(entry))) {
      seen.add(entryKey(entry));
      merged.push(cleanEntry(entry));
    }
  }
  merged.sort((a, b) => b.when.localeCompare(a.when));
  return merged.slice(0, MAX_HISTORY_ENTRIES);
}

function withoutReplays(entries: HistoryEntry[]): HistoryEntry[] {
  return entries.map((entry) => {
    const slim = { ...entry };
    delete slim.result;
    return slim;
  });
}

/**
 * Persist history, shedding full replays when the store is full so the
 * summaries (scores, prompts) still survive a quota error.
 */
export function storeHistory(entries: HistoryEntry[]): void {
  try {
    window.localStorage.setItem(HISTORY_KEY, JSON.stringify(entries));
    return;
  } catch {
    // Fall through to the summaries-only retry below.
  }
  try {
    window.localStorage.setItem(HISTORY_KEY, JSON.stringify(withoutReplays(entries)));
  } catch {
    // A blocked store must not break the run flow.
  }
}
