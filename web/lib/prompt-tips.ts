/**
 * Value-driven prompt tips: the dashboard's practice advice used to
 * be four static lines. These rules fire off the run's own numbers
 * instead — skips, shock dips, losses, spread, budget — highest
 * severity first, each quoting the value that triggered it. Static
 * lines survive only as filler when little fires.
 */

import type { MatchResultPayload } from "./sim";

/** Firing thresholds; tuned to typical 0-100 score scales. */
const SPREAD_TIP = 8;
const SHOCK_DIP_TIP = 10;
const LIVES_LOST_TIP = 500;
const WEAK_SUBSCORE_TIP = 55;
const BUDGET_WARN_RATIO = 0.9;
const BUDGET_HEADROOM_RATIO = 0.5;
const MAX_TIPS = 4;
const MIN_TIPS = 3;

interface Tip {
  severity: number;
  text: string;
}

const STATIC_TIPS: readonly string[] = [
  "Focus on stewardship trade-offs, not generic advice.",
  "Explicitly reference shocks at turns 5 and 9.",
  "Use concise directives: “prioritize housing before shock, then rescue”.",
  "Test variants with same seed to isolate prompt effect.",
];

function impactAt(
  turns: MatchResultPayload["turns"],
  turnNo: number,
): number | undefined {
  return turns.find((t) => t.turn === turnNo)?.impact;
}

/** Impact lost from the eve of a shock window to its worst turn. */
function windowDip(
  turns: MatchResultPayload["turns"],
  eve: number,
  window: readonly number[],
): number | undefined {
  const before = impactAt(turns, eve);
  const during = window
    .map((n) => impactAt(turns, n))
    .filter((v): v is number => typeof v === "number");
  if (before === undefined || during.length !== window.length) {
    return undefined;
  }
  return before - Math.min(...during);
}

const SUBSCORE_ADVICE: Readonly<Record<string, string>> = {
  wellbeing: "fund clinics and housing steadily, not in bursts",
  lives: "stabilize the exposed fast: rescue and shelter the turn a shock lands",
  infra: "repair early; decay compounds every turn you wait",
  fiscal: "hold reserves; debt drags every turn after it",
};

export interface TipContext {
  /** Impact spread across the compared runs, from the dashboard. */
  impactSpread: number;
}

/** Ordered practice tips for one run; never empty, at most four. */
export function buildTips(active: MatchResultPayload, context: TipContext): string[] {
  const tips: Tip[] = [];

  const skipped = active.strategy.skipped_turns;
  if (typeof skipped === "number" && skipped > 0) {
    const reasons = [
      ...new Set(
        active.turns.map((t) => t.skip_reason).filter((r): r is string => r !== null),
      ),
    ];
    const why = reasons.length > 0 ? ` (${reasons.join(", ")})` : "";
    tips.push({
      severity: 100,
      text:
        `${String(skipped)} turn${skipped === 1 ? "" : "s"} skipped${why} — ` +
        "shorten the reply: cap reasoning and demand the JSON first.",
    });
  }

  const lost = active.totals.lives_lost;
  const lostFlood = active.totals.lives_lost_flood;
  if (typeof lost === "number" && lost > LIVES_LOST_TIP) {
    const flood =
      typeof lostFlood === "number"
        ? `, ${String(Math.round(lostFlood))} to the flood`
        : "";
    tips.push({
      severity: 90,
      text:
        `${String(Math.round(lost))} lives lost${flood} — shelter before beauty: ` +
        "fund housing and health before green.",
    });
  }

  const floodDip = windowDip(active.turns, 4, [5, 6]);
  if (floodDip !== undefined && floodDip > SHOCK_DIP_TIP) {
    tips.push({
      severity: 80,
      text:
        `The turn-5 flood cost ${floodDip.toFixed(2)} impact — pre-position ` +
        "rescue and shelter by turn 4 instead of reacting at 5.",
    });
  }

  const lateDip = windowDip(active.turns, 8, [9, 10]);
  if (lateDip !== undefined && lateDip > SHOCK_DIP_TIP) {
    tips.push({
      severity: 75,
      text:
        `Turns 9–10 cost ${lateDip.toFixed(2)} impact — hold reserves through ` +
        "turn 8; the second shock punishes empty coffers.",
    });
  }

  if (context.impactSpread > SPREAD_TIP) {
    tips.push({
      severity: 70,
      text:
        `Impact swings ${context.impactSpread.toFixed(2)} across runs — pin ` +
        "reserves early and name explicit shock triggers so the model stops improvising.",
    });
  }

  // Emissions excluded: ~2 is a normal cut, not a crisis.
  const weak = ["wellbeing", "lives", "infra", "fiscal"]
    .map((key) => ({ key, value: active.scores[key] }))
    .filter(
      (entry): entry is { key: string; value: number } =>
        typeof entry.value === "number",
    )
    .sort((a, b) => a.value - b.value)[0];
  const livesFired = tips.some((tip) => tip.severity === 90);
  if (
    weak !== undefined &&
    weak.value < WEAK_SUBSCORE_TIP &&
    !(weak.key === "lives" && livesFired)
  ) {
    const label = weak.key.charAt(0).toUpperCase() + weak.key.slice(1);
    const advice = SUBSCORE_ADVICE[weak.key] ?? "fund it earlier and steadier";
    tips.push({
      severity: 60,
      text: `${label} is your floor at ${weak.value.toFixed(2)} — ${advice}.`,
    });
  }

  const used = active.totals.tokens_used;
  const budget = active.token_budget;
  if (typeof used === "number" && typeof budget === "number" && budget > 0) {
    const ratio = used / budget;
    if (ratio >= BUDGET_WARN_RATIO) {
      tips.push({
        severity: 50,
        text:
          `Token budget ${String(Math.round(ratio * 100))}% spent — compress: fewer ` +
          "policies, tighter allocations, shorter notes.",
      });
    } else if (ratio < BUDGET_HEADROOM_RATIO) {
      tips.push({
        severity: 20,
        text:
          `Only ${String(Math.round(ratio * 100))}% of the token budget used — room for ` +
          "richer prompts and explicit contingencies.",
      });
    }
  }

  const ordered = tips.sort((a, b) => b.severity - a.severity).map((tip) => tip.text);
  const filled = [...ordered];
  for (const fallback of STATIC_TIPS) {
    if (filled.length >= MIN_TIPS || filled.length >= MAX_TIPS) {
      break;
    }
    filled.push(fallback);
  }
  return filled.slice(0, MAX_TIPS);
}
