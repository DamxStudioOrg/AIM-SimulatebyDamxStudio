/**
 * Three-variant runs: the same prompt over a few variety, best run
 * counts. Open play varies the seed (the slider's chaos rides all
 * three); an armed challenge keeps its locked seed and varies the
 * chaos instead, so the trial's calibrated world stays the trial.
 */

import type { MatchResultPayload } from "./sim";

export interface VariantSpec {
  /** Compare-strip label: "Seed 12" or "Chaos 50%". */
  label: string;
  seed: number;
  /** Chaos 0..1; undefined sends no chaos key (legacy world). */
  chaosLevel: number | undefined;
}

export interface VariantInput {
  seed: number;
  /** Slider chaos 0-100; only used when no challenge is armed. */
  chaos: number;
  challenged: boolean;
}

/** The three worlds one variety run plays, in strip order. */
export function buildVariants(input: VariantInput): VariantSpec[] {
  if (!input.challenged) {
    const level = input.chaos > 0 ? input.chaos / 100 : undefined;
    return [0, 1, 2].map((offset) => ({
      label: `Seed ${String(input.seed + offset)}`,
      seed: input.seed + offset,
      chaosLevel: level,
    }));
  }
  return [0, 50, 100].map((percent) => ({
    label: `Chaos ${String(percent)}%`,
    seed: input.seed,
    chaosLevel: percent === 0 ? undefined : percent / 100,
  }));
}

/** One finished variety run for the compare strip. */
export interface VariantRun {
  label: string;
  result: MatchResultPayload;
}

/** Index of the best run by impact; ties go to the earliest variant. */
export function bestVariantIndex(results: MatchResultPayload[]): number {
  let best = 0;
  for (let index = 1; index < results.length; index += 1) {
    const impact = results[index]?.scores.impact ?? 0;
    const top = results[best]?.scores.impact ?? 0;
    if (impact > top) {
      best = index;
    }
  }
  return best;
}
