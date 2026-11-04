/** Shared scene derivation for the city stages (iso + street).
Client-safe: stages must not import the server-only sim client beyond types.
Allocations are percent shares (8 keys summing to 100); spend is dollars. */

import type { MatchTurn } from "./sim";

export const CITY_KEYS = [
  "housing",
  "transit",
  "health",
  "green",
  "reserves",
  "rescue",
  "shelter",
  "repair",
] as const;

export type CityKey = (typeof CITY_KEYS)[number];

/** Display scale: one vector unit = one share point of $3.5k spend, so a
typical ~$105k turn lands mid-scale and neglect shows as drama. */
export const SPEND_UNIT = 3500;

export const EVEN_SPLIT: Record<string, number> = Object.fromEntries(
  CITY_KEYS.map((key) => [key, 100 / CITY_KEYS.length]),
);

/** Latest allocation at or before a 1-based turn; even split when unknown. */
export function allocationAt(
  turns: MatchTurn[],
  turnNo: number,
): Record<string, number> {
  for (let n = turnNo; n >= 1; n -= 1) {
    const found = turns[n - 1]?.allocation;
    if (found !== null && found !== undefined) {
      return found;
    }
  }
  return EVEN_SPLIT;
}

/** Per-key spend vector for one turn: share (0..1) × spend / SPEND_UNIT. */
export function spendVec(turn: MatchTurn | undefined): number[] {
  const alloc = turn?.allocation ?? EVEN_SPLIT;
  const spend = turn?.spend ?? 0;
  return CITY_KEYS.map((key) => ((alloc[key] ?? 0) / 100) * (spend / SPEND_UNIT));
}

export function totalTokens(turns: MatchTurn[]): number {
  return turns.reduce((sum, turn) => sum + turn.tokens_used, 0);
}

export function spentThrough(
  turns: MatchTurn[],
  doneTurns: number,
): { tokens: number; dollars: number } {
  let tokens = 0;
  let dollars = 0;
  for (let i = 0; i < doneTurns && i < turns.length; i += 1) {
    const turn = turns[i];
    if (turn !== undefined) {
      tokens += turn.tokens_used;
      dollars += turn.spend;
    }
  }
  return { tokens, dollars };
}

/** Cost load drags efficiency down as spend and token burn grow. */
export function costLoad(dollars: number, tokens: number): number {
  return 1 + dollars / 500000 + tokens / 15000;
}

/** Deterministic 0..1 stream so a seed always paints the same extras. */
export function mulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let z = Math.imul(s ^ (s >>> 15), 1 | s);
    z = (z + Math.imul(z ^ (z >>> 7), 61 | z)) ^ z;
    return ((z ^ (z >>> 14)) >>> 0) / 4294967296;
  };
}
