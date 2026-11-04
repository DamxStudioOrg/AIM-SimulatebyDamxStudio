/**
 * Model judge (opt-in, tier 4): one rubric-bound call on the
 * player's own model critiques the steward prompt against the run
 * it produced. The sim validates the verdict shape; this module
 * builds the message and re-checks the reply before it renders —
 * model output is never trusted twice.
 */

import type { MatchResultPayload } from "./sim";

export interface JudgeVerdict {
  scores: {
    clarity: number;
    specificity: number;
    contingency: number;
    economy: number;
  };
  advice: string[];
}

const DIMENSIONS = ["clarity", "specificity", "contingency", "economy"] as const;

/** The user message: the draft, then the facts of its run. */
export function buildJudgeMessage(prompt: string, result: MatchResultPayload): string {
  const skipped = result.turns.filter((turn) => turn.skip_reason !== null).length;
  const played = result.turns.length - skipped;
  const facts = [
    `seed ${String(result.seed)}`,
    `impact ${(result.scores.impact ?? 0).toFixed(1)}`,
    `efficiency ${(result.scores.efficiency ?? 0).toFixed(2)}`,
    `${String(played)} turns played, ${String(skipped)} skipped`,
    `${String(result.totals.tokens_used)} tokens used of ${String(result.token_budget)}`,
  ].join(" · ");
  return [
    "Steward prompt under review:",
    '"""',
    prompt.trim(),
    '"""',
    "",
    `The run it produced: ${facts}.`,
    "Judge the prompt, not the luck: score what the words instructed.",
  ].join("\n");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Defensive parse of a judge verdict; null when the shape is off. */
export function parseJudgeVerdict(raw: unknown): JudgeVerdict | null {
  if (!isRecord(raw) || !isRecord(raw.scores)) {
    return null;
  }
  const scores = {} as JudgeVerdict["scores"];
  for (const dimension of DIMENSIONS) {
    const value = raw.scores[dimension];
    if (typeof value !== "number" || Number.isNaN(value)) {
      return null;
    }
    scores[dimension] = Math.max(0, Math.min(10, Math.round(value)));
  }
  const advice: string[] = [];
  if (Array.isArray(raw.advice)) {
    for (const entry of raw.advice) {
      if (typeof entry === "string" && entry.trim() !== "") {
        advice.push(entry.trim().slice(0, 160));
      }
      if (advice.length >= 3) {
        break;
      }
    }
  }
  return { scores, advice };
}
