/**
 * Actionable loss gaps: where this run's mean allocation trails a
 * better reference run on the same seed, in allocation points.
 */
import { entryGame } from "./history";
import type { HistoryEntry } from "./history";
import type { MatchResultPayload } from "./sim";

export interface AllocationGap {
  key: string;
  /** Reference mean minus this run's mean, in allocation points. */
  delta: number;
}

function meanAllocation(result: MatchResultPayload): Record<string, number> {
  return result.strategy.mean_allocation;
}

/**
 * Largest under-allocation gaps vs the reference, biggest first.
 * Only gaps of at least `minDelta` points are worth acting on.
 */
export function allocationGaps(
  result: MatchResultPayload,
  reference: MatchResultPayload,
  minDelta = 3,
): AllocationGap[] {
  const mine = meanAllocation(result);
  const theirs = meanAllocation(reference);
  const gaps: AllocationGap[] = [];
  for (const [key, refValue] of Object.entries(theirs)) {
    const delta = refValue - (mine[key] ?? 0);
    if (delta >= minDelta) {
      gaps.push({ key, delta });
    }
  }
  return gaps.sort((a, b) => b.delta - a.delta);
}

/** Best recorded city run on this seed that beat the current result. */
export function bestSeedReference(
  entries: HistoryEntry[],
  result: MatchResultPayload,
): MatchResultPayload | null {
  let best: MatchResultPayload | null = null;
  let bestImpact = result.scores.impact ?? 0;
  for (const entry of entries) {
    if (entryGame(entry) !== "city" || entry.seed !== result.seed) continue;
    const recorded = entry.result;
    if (recorded === undefined || !("strategy" in recorded)) continue;
    const impact = recorded.scores.impact ?? 0;
    if (impact > bestImpact) {
      bestImpact = impact;
      best = recorded;
    }
  }
  return best;
}

/** One plain-language line per gap, e.g. for the Result section. */
export function gapLines(
  result: MatchResultPayload,
  reference: MatchResultPayload,
): string[] {
  return allocationGaps(result, reference).map(
    (gap) =>
      `${gap.key} underfunded by ${gap.delta.toFixed(0)} points vs your best run on this seed`,
  );
}
