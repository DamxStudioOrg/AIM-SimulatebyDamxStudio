/**
 * Aftermath coaching: where the run could have gone differently.
 * Pure rules over the finished turn log — costliest drops, idle
 * turns, skips, and lopsided allocation — each quoting the value
 * that fired it. Highest severity first, at most four.
 */

import type { MatchResultPayload } from "./sim";

/** Firing thresholds; tuned to typical 0-100 impact scales. */
const DROP_TIP = 8;
const IDLE_SPEND = 1;
const FOCUS_SHARE = 70;
const MAX_TIPS = 4;

interface Tip {
  severity: number;
  text: string;
}

function impacts(
  turns: MatchResultPayload["turns"],
): { turn: number; value: number }[] {
  return turns
    .filter(
      (entry): entry is typeof entry & { impact: number } =>
        typeof entry.impact === "number",
    )
    .map((entry) => ({ turn: entry.turn, value: entry.impact }));
}

export interface Coaching {
  tips: string[];
  /** Turns to tint on the strip: the costliest drops. */
  flagTurns: number[];
  /** Pattern counts the drill focus reads across recent runs. */
  signals: {
    skipped: number;
    shockDips: number;
    idle: number;
    concentrated: boolean;
  };
}

/** Ordered coaching for one finished run; tips may be empty. */
export function buildCoaching(result: MatchResultPayload): Coaching {
  const tips: Tip[] = [];
  const turns = result.turns;

  const skipped = turns.filter((entry) => entry.skip_reason !== null);
  if (skipped.length > 0) {
    const reasons = [
      ...new Set(
        skipped
          .map((entry) => entry.skip_reason)
          .filter((reason): reason is string => reason !== null),
      ),
    ];
    const why = reasons.length > 0 ? ` (${reasons.join(", ")})` : "";
    tips.push({
      severity: 100,
      text:
        `${String(skipped.length)} turn${skipped.length === 1 ? "" : "s"} never ran${why} — ` +
        "every skipped turn scores zero, so shorten replies until none skip.",
    });
  }

  const series = impacts(turns);
  let worstDrop = 0;
  let worstTurn = 0;
  for (let index = 1; index < series.length; index += 1) {
    const before = series[index - 1];
    const after = series[index];
    if (before === undefined || after === undefined) {
      continue;
    }
    const drop = before.value - after.value;
    if (drop > worstDrop) {
      worstDrop = drop;
      worstTurn = after.turn;
    }
  }
  if (worstDrop > DROP_TIP) {
    tips.push({
      severity: 90,
      text:
        `Turn ${String(worstTurn)} lost ${worstDrop.toFixed(2)} impact — the run's ` +
        "worst step. Fund the rescue one turn earlier and re-run the seed.",
    });
  }

  // Shock dips: sizeable single-turn drops on the shock turns.
  let shockDips = 0;
  for (let index = 1; index < series.length; index += 1) {
    const before = series[index - 1];
    const after = series[index];
    if (
      before !== undefined &&
      after !== undefined &&
      (after.turn === 5 || after.turn === 9) &&
      before.value - after.value >= 5
    ) {
      shockDips += 1;
    }
  }

  const idle = turns.filter(
    (entry) => entry.skip_reason === null && entry.spend < IDLE_SPEND,
  ).length;
  if (idle > 0) {
    tips.push({
      severity: 70,
      text:
        `${String(idle)} turn${idle === 1 ? "" : "s"} spent nothing — idle money ` +
        "earns no impact, so park a standing order instead of skipping.",
    });
  }

  const shares = new Map<string, number>();
  let counted = 0;
  let topMean = 0;
  for (const entry of turns) {
    if (entry.allocation === null) {
      continue;
    }
    counted += 1;
    for (const [key, value] of Object.entries(entry.allocation)) {
      shares.set(key, (shares.get(key) ?? 0) + value);
    }
  }
  if (counted > 0) {
    let topKey = "";
    for (const [key, total] of shares) {
      const mean = total / counted;
      if (mean > topMean) {
        topMean = mean;
        topKey = key;
      }
    }
    if (topMean >= FOCUS_SHARE) {
      tips.push({
        severity: 60,
        text:
          `${topMean.toFixed(0)}% of every budget went to ${topKey} — spread ` +
          "the next run across two departments and compare the boards.",
      });
    }
  }

  const ordered = tips.sort((a, b) => b.severity - a.severity).map((tip) => tip.text);
  return {
    tips: ordered.slice(0, MAX_TIPS),
    flagTurns: worstDrop > DROP_TIP ? [worstTurn] : [],
    signals: {
      skipped: skipped.length,
      shockDips,
      idle,
      concentrated: counted > 0 && topMean >= FOCUS_SHARE,
    },
  };
}
