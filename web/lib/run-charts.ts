/**
 * Domain series for the BoardUI chart cards: per-turn run comparison
 * (active run vs compare run) and prompt-version progress (each version
 * vs the one before it). Pure mapping — the cards own all rendering.
 */
import type { RevenuePoint } from "@/components/application/dashboard/revenue-chart-card";
import type { OrdersPoint } from "@/components/application/dashboard/orders-chart-card";
import type { MatchTurn } from "./sim";
import type { HistoryEntry } from "./history";

/** Axis label for a sim turn: T1..T12, never a month name. */
export function turnLabel(turn: number): string {
  return `T${String(turn)}`;
}

/**
 * Per-turn impact: the active run's area against the compare run's
 * dashed line, matched by turn number. Turns the compare run lacks
 * read 0 (shorter run), and a missing compare run flatlines at 0 so
 * the delta chip honestly reports a first run as New.
 */
export function turnImpactSeries(
  active: MatchTurn[],
  compare?: MatchTurn[],
): RevenuePoint[] {
  const previousByTurn = new Map<number, number>();
  for (const turn of compare ?? []) {
    previousByTurn.set(turn.turn, turn.impact ?? 0);
  }
  return active.map((turn) => ({
    label: turnLabel(turn.turn),
    current: turn.impact ?? 0,
    previous: previousByTurn.get(turn.turn) ?? 0,
  }));
}

/**
 * Per-turn token burn: the active run's bars beside the compare run's,
 * matched by turn number with the same missing-turn rule as impact.
 */
export function turnTokenSeries(
  active: MatchTurn[],
  compare?: MatchTurn[],
): OrdersPoint[] {
  const previousByTurn = new Map<number, number>();
  for (const turn of compare ?? []) {
    previousByTurn.set(turn.turn, turn.tokens_used);
  }
  return active.map((turn) => ({
    label: turnLabel(turn.turn),
    current: turn.tokens_used,
    previous: previousByTurn.get(turn.turn) ?? 0,
  }));
}

/** Short axis date for a prompt version: MM-DD of the stored run. */
export function versionLabel(when: string): string {
  return when.slice(5, 10);
}

/**
 * Prompt-version progress: each recorded version's impact against the
 * version before it, oldest first, so the area tells whether the
 * prompt is improving run over run. History stores newest first, so
 * the kept entries reverse; entries without impact are skipped; the
 * first kept version compares against 0 (New).
 */
export function versionImpactSeries(entries: HistoryEntry[]): RevenuePoint[] {
  const scored = entries.filter((entry) => entry.impact !== undefined).reverse();
  return scored.map((entry, index) => ({
    label: versionLabel(entry.when),
    current: entry.impact ?? 0,
    previous: index === 0 ? 0 : (scored[index - 1]?.impact ?? 0),
  }));
}
