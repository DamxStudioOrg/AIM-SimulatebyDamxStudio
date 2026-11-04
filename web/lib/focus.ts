/**
 * Drill focus (tier 5): read the player's recent record — measured
 * run patterns first, prompt-craft gaps second — and name the one
 * drill that trains the recurring weakness. Quiet until the
 * record can speak: a single bad run is weather, not a pattern.
 */

import { challengeById } from "./challenges";
import { buildCoaching } from "./coaching";
import { analyzePrompt } from "./prompt-analysis";
import type { MatchResultPayload } from "./sim";

export interface FocusPick {
  drillId: string;
  title: string;
  reason: string;
}

const RECENT_RUNS = 6;
const RECENT_PROMPTS = 6;

function pick(drillId: string, reason: string): FocusPick | null {
  const drill = challengeById(drillId);
  return drill === undefined ? null : { drillId, title: drill.title, reason };
}

/**
 * The drill for the player's dominant recent weakness, or null
 * when the record is too thin or too clean to name one.
 */
export function focusDrill(input: {
  prompts: readonly string[];
  results: readonly MatchResultPayload[];
}): FocusPick | null {
  const results = input.results.slice(0, RECENT_RUNS);
  if (results.length >= 2) {
    let skipped = 0;
    let shockRuns = 0;
    let concentratedRuns = 0;
    for (const result of results) {
      const { signals } = buildCoaching(result);
      skipped += signals.skipped;
      if (signals.shockDips > 0) {
        shockRuns += 1;
      }
      if (signals.concentrated) {
        concentratedRuns += 1;
      }
    }
    if (skipped >= 3) {
      return pick(
        "drill-eighty",
        `${String(skipped)} skipped turns across your last ${String(results.length)} runs — skipped turns score zero. Train tight replies.`,
      );
    }
    if (shockRuns >= 2) {
      return pick(
        "drill-two-shocks",
        `Shock turns drew blood in ${String(shockRuns)} of your last ${String(results.length)} runs. Write both answers before you run.`,
      );
    }
    if (concentratedRuns >= 2) {
      return pick(
        "drill-one-clause",
        `${String(concentratedRuns)} of your last ${String(results.length)} runs rode one department. Change one clause at a time and price it.`,
      );
    }
  }

  const prompts = input.prompts
    .filter((prompt) => prompt.trim() !== "")
    .slice(0, RECENT_PROMPTS);
  if (prompts.length >= 3) {
    const missing = new Map<string, number>();
    for (const prompt of prompts) {
      for (const entry of analyzePrompt(prompt).items) {
        if (entry.state === "missing") {
          missing.set(entry.id, (missing.get(entry.id) ?? 0) + 1);
        }
      }
    }
    let dominant: string | null = null;
    let dominantCount = 1; // must recur: missing in 2+ of the recent prompts
    for (const [id, count] of missing) {
      if (count > dominantCount) {
        dominant = id;
        dominantCount = count;
      }
    }
    if (dominant === "departments" || dominant === "numbers") {
      return pick(
        "drill-fix",
        `Your last ${String(prompts.length)} prompts keep skipping the same move: ${dominant === "numbers" ? "no numbers" : "unnamed departments"}. Rewrite a draft that makes them.`,
      );
    }
    if (
      dominant === "conditionals" ||
      dominant === "reserves" ||
      dominant === "shocks" ||
      dominant === "hazards"
    ) {
      return pick(
        "drill-two-shocks",
        `Your last ${String(prompts.length)} prompts rarely plan for the shocks. Write the turn-5 and turn-9 answers down.`,
      );
    }
    if (dominant === "discipline") {
      return pick(
        "drill-eighty",
        `Your last ${String(prompts.length)} prompts never ask for tight replies. Compression trains exactly that.`,
      );
    }
  }
  return null;
}
