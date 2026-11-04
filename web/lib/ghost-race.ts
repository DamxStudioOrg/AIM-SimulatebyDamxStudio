/**
 * Ghost racing: race a live result against a recorded same-seed run.
 * Only runs whose every turn carries running scores can race; older
 * replays are refused instead of guessed.
 */
import type { HistoryEntry } from "./history";
import { entryGame } from "./history";
import type { MatchResultPayload, MatchTurn } from "./sim";

export interface RacePoint {
  turn: number;
  impact: number;
  efficiency: number;
}

export interface RaceDelta extends RacePoint {
  impactDelta: number;
  efficiencyDelta: number;
}

export interface RaceVerdict {
  impactDelta: number;
  efficiencyDelta: number;
}

/** Per-turn running scores, or null when any turn predates race timing. */
export function raceSeries(turns: MatchTurn[]): RacePoint[] | null {
  const series: RacePoint[] = [];
  for (const turn of turns) {
    if (typeof turn.impact !== "number" || typeof turn.efficiency !== "number") {
      return null;
    }
    series.push({ turn: turn.turn, impact: turn.impact, efficiency: turn.efficiency });
  }
  return series;
}

function isMatchReplay(value: unknown): value is MatchResultPayload {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  return Array.isArray((value as Record<string, unknown>).turns);
}

/** A history entry's raceable series, or null when it cannot race. */
export function ghostSeries(entry: HistoryEntry): RacePoint[] | null {
  if (entryGame(entry) !== "city" || entry.result === undefined) {
    return null;
  }
  if (!isMatchReplay(entry.result)) {
    return null;
  }
  return raceSeries(entry.result.turns);
}

/** Live-minus-ghost deltas per turn; null when the two cannot compare. */
export function raceDeltas(
  live: MatchResultPayload,
  ghost: RacePoint[],
): RaceDelta[] | null {
  const liveSeries = raceSeries(live.turns);
  if (liveSeries?.length !== ghost.length) {
    return null;
  }
  const deltas: RaceDelta[] = [];
  for (const [index, point] of liveSeries.entries()) {
    const against = ghost[index];
    if (against === undefined) {
      return null;
    }
    deltas.push({
      ...point,
      impactDelta: point.impact - against.impact,
      efficiencyDelta: point.efficiency - against.efficiency,
    });
  }
  return deltas;
}

/** Final-turn deltas, or null when the race has no turns. */
export function raceVerdict(deltas: RaceDelta[]): RaceVerdict | null {
  const last = deltas[deltas.length - 1];
  if (last === undefined) {
    return null;
  }
  return { impactDelta: last.impactDelta, efficiencyDelta: last.efficiencyDelta };
}

/** Signed two-decimal delta for race readouts. */
export function formatDelta(value: number): string {
  const rounded = value.toFixed(2);
  return value < 0 ? rounded : `+${rounded}`;
}
