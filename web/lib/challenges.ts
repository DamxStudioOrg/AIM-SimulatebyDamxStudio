/**
 * Prompt-writing challenges: fixed seeds with posted goals, calibrated
 * against real sim data so every bar is beatable by sharp play and
 * unbeatable by the fixed baseline strategy.
 *
 * Calibration (sim 0.1.0, rescue-heavy "rh" vs fixed "baseline" strategy,
 * re-verified 2026-10-27 with a headless scripted probe across seeds 1-15):
 * - seed 11, flood west: rh impact 58.11, baseline 52.85 → bar 56.
 * - seed 8, southern heatwave at turn 9: rh heat deaths 190, baseline 239 →
 *   bar 215. (An older note claimed this heatwave for seed 2; the current
 *   sim draws infra_failure on seed 2's turn 9, so the challenge moved.)
 * - seed 9: rh efficiency 14.72, baseline 13.97 → bar 14.5. (An older note
 *   claimed 15.0/15.4, but a 2026-10-27 strategy sweep topped out at 14.72;
 *   the bar now sits between proven numbers.)
 * - seed 9 thrifty: spend 890,836, impact 45.9; baseline spends ~1.26M →
 *   bars $1.05M and impact 40.
 * - seed 12 (harshest): rh impact 48.24, baseline 45.79 → bar 47.
 * - seed 5 (fiercest heatwave): rh heat deaths 1036, baseline 1113 → bar 1080.
 * - seed 10: rh heat deaths 892, baseline 958 → bar 925.
 * - seed 11 books: rh efficiency 14.90, baseline 14.09 → bar 14.5.
 * If the sim changes, re-run the calibration probes and move the bars.
 *
 * Task limits: every challenge sets its own prompt word cap and match token
 * budget (all pairs differ). Budgets stay at 6,000+, above measured
 * scripted usage (~3.3k/match), so the bars above stand untouched.
 */

import type { ChallengeAssets } from "./asset-schema";
import type { MatchResultPayload } from "./sim";

export interface ChallengeGoals {
  minImpact?: number;
  minEfficiency?: number;
  maxSpend?: number;
  maxTokens?: number;
  maxHeatwaveDeaths?: number;
  /** Tote tasks only: minimum pack score from the tote grader. */
  minPackScore?: number;
}

export interface Challenge {
  id: string;
  /** Which simulation the task runs: the city match or a tote pack. */
  kind: "city" | "tote";
  title: string;
  brief: string;
  seed: number;
  tip: string;
  goals: ChallengeGoals;
  /**
   * Complexity drivers: the named variables a steward must juggle
   * (shocks, caps, scarcities). Budgets derive from the count, so
   * harder trials grant more words and context — and trials with
   * the same count honestly share a budget.
   */
  drivers: string[];
  /** Prompt word cap for this task (open play uses the contract default). */
  words: number;
  /** Match token budget for this task (open play uses the contract default). */
  tokenBudget: number;
  /** Story beats the stage animates before the player writes a prompt. */
  story: string[];
  /** Rotation trials only: validated stage dressing, if the proposal carries any. */
  assets?: ChallengeAssets | null;
  /** Drills only: the draft the form opens with (a flawed prompt to fix). */
  starterPrompt?: string;
}

/**
 * Trial budgets from declared variables: each driver is one more
 * thing to reason about, worth room to name a contingency (+25
 * words) and run one more reasoning branch (+1,500 tokens). Same
 * drivers, same budget — the pressure comes from the trial, and
 * endless cycles raise the bars on flat budgets on top.
 */
export const TRIAL_WORDS_BASE = 120;
export const TRIAL_WORDS_PER_DRIVER = 25;
export const TRIAL_TOKENS_BASE = 6000;
export const TRIAL_TOKENS_PER_DRIVER = 1500;

export function trialBudgets(drivers: string[]): {
  drivers: string[];
  words: number;
  tokenBudget: number;
} {
  return {
    drivers: [...drivers],
    words: TRIAL_WORDS_BASE + TRIAL_WORDS_PER_DRIVER * drivers.length,
    tokenBudget: TRIAL_TOKENS_BASE + TRIAL_TOKENS_PER_DRIVER * drivers.length,
  };
}

/** Extra prompt words by Impact-board position: small by design. */
export const RANK_WORD_BONUS: Record<number, number> = { 1: 15, 2: 10, 3: 5 };

/** A few extra words for the top three; nobody else gains any. */
export function rankWordBonus(position: number | null): number {
  if (position === null) {
    return 0;
  }
  return RANK_WORD_BONUS[position] ?? 0;
}

/** Chain order is array order: each challenge unlocks behind the last. */
export function isChallengeUnlocked(
  id: string,
  clearedIds: readonly string[],
): boolean {
  const index = CHALLENGES.findIndex((entry) => entry.id === id);
  if (index < 0) {
    return false;
  }
  if (index === 0) {
    return true;
  }
  const previous = CHALLENGES[index - 1];
  return previous !== undefined && clearedIds.includes(previous.id);
}

/** Challenges the player may see: unlocked ones only, locked hidden. */
export function unlockedChallenges(clearedIds: readonly string[]): Challenge[] {
  return CHALLENGES.filter((entry) => isChallengeUnlocked(entry.id, clearedIds));
}

/**
 * The challenge the casual flow offers next: the first uncleared
 * one in chain order (locked gaps count as next, never skipped).
 */
export function nextChallenge(clearedIds: readonly string[]): Challenge | undefined {
  return CHALLENGES.find((entry) => !clearedIds.includes(entry.id));
}

export interface ProgressSummary {
  cleared: number;
  total: number;
  /** Endless cycles cleared across all trials; the climb past the chain. */
  endless: number;
  /** Tote drop-ins cleared; the packing simulation beside the city. */
  tote: number;
  bestImpact: number | null;
  bestEfficiency: number | null;
}

/** Local progress rollup for the Stats view; unknown ids ignored. */
export function summarizeProgress(
  completions: Record<string, Completion>,
): ProgressSummary {
  let bestImpact: number | null = null;
  let bestEfficiency: number | null = null;
  for (const entry of CHALLENGES) {
    const done = completions[entry.id];
    if (done === undefined) {
      continue;
    }
    bestImpact = bestImpact === null ? done.impact : Math.max(bestImpact, done.impact);
    bestEfficiency =
      bestEfficiency === null
        ? done.efficiency
        : Math.max(bestEfficiency, done.efficiency);
  }
  const endless = Object.keys(completions).filter((id) => {
    const parsed = parseEndlessId(id);
    return (
      parsed !== null &&
      (CHALLENGES.some((entry) => entry.id === parsed.baseId) ||
        TOTE_CHALLENGES.some((entry) => entry.id === parsed.baseId))
    );
  }).length;
  return {
    cleared: CHALLENGES.filter((entry) => completions[entry.id] !== undefined).length,
    total: CHALLENGES.length,
    endless,
    tote: TOTE_CHALLENGES.filter((entry) => completions[entry.id] !== undefined).length,
    bestImpact,
    bestEfficiency,
  };
}

export const COMPLETIONS_KEY = "aim-arena-challenges";

export interface Completion {
  when: string;
  /** Unified run score (0-100): city impact, or normalized tote pack. */
  impact: number;
  efficiency: number;
  model: string;
  /** Stamped on new clears; legacy clears infer kind from the id. */
  kind?: Challenge["kind"];
  /** Tote clears only: the raw pack score behind the normalized impact. */
  raw?: number;
}

/** Cleared challenge ids from local completions; tolerant of bad data. */
export function clearedChallengeIds(completions: Record<string, Completion>): string[] {
  return Object.keys(completions);
}

/**
 * Local completions map; corrupt or missing storage reads as empty.
 * Reads the store directly unless given text (sealed callers pass
 * the opened envelope instead of touching storage twice).
 */
export function loadCompletions(raw?: string | null): Record<string, Completion> {
  try {
    const text = raw === undefined ? window.localStorage.getItem(COMPLETIONS_KEY) : raw;
    if (text === null) {
      return {};
    }
    const parsed: unknown = JSON.parse(text);
    if (typeof parsed !== "object" || parsed === null) {
      return {};
    }
    const out: Record<string, Completion> = {};
    for (const [key, value] of Object.entries(parsed)) {
      const candidate = value as Record<string, unknown> | null;
      if (
        typeof candidate === "object" &&
        candidate !== null &&
        typeof candidate.impact === "number"
      ) {
        out[key] = {
          when: typeof candidate.when === "string" ? candidate.when : "",
          impact: candidate.impact,
          efficiency:
            typeof candidate.efficiency === "number" ? candidate.efficiency : 0,
          model: typeof candidate.model === "string" ? candidate.model : "",
          ...(candidate.kind === "city" || candidate.kind === "tote"
            ? { kind: candidate.kind }
            : {}),
          ...(typeof candidate.raw === "number" ? { raw: candidate.raw } : {}),
        };
      }
    }
    return out;
  } catch {
    return {};
  }
}

export const CHALLENGES: Challenge[] = [
  {
    kind: "city",
    id: "debut",
    title: "First whistle",
    brief:
      "Seed 1 runs quiet with trouble muttering on the forecast. Finish any valid match and take the steward's oath.",
    seed: 1,
    tip: "Anything that validates counts. Then beat the baseline for real.",
    goals: { minImpact: 0 },
    ...trialBudgets(["orientation"]),
    story: [
      "A quiet city on a calm river swears in a new steward: you.",
      "Twelve turns lie ahead, and the forecast already mutters about water.",
      "Finish the match — any valid run takes the oath.",
    ],
  },
  {
    kind: "city",
    id: "flood-wall",
    title: "Hold the west wall",
    brief:
      "A severity-5 flood hits the west district. Stock the clinics, stage the buses, open shelters before the water — hold impact 56 or better.",
    seed: 11,
    tip: "Rescue early and hard; open_shelters doubles rehousing while the water is up.",
    goals: { minImpact: 56 },
    ...trialBudgets(["severity-5 flood", "west exposure", "shelter timing"]),
    story: [
      "The west district wakes to sirens: a severity-5 flood is coming upriver.",
      "Clinics stock bandages, buses idle at the depot, the river keeps rising.",
      "Hold the city at impact 56 or better while the water does its worst.",
    ],
  },
  {
    kind: "city",
    id: "southside-heatwave",
    title: "Southside heatwave",
    brief:
      "A southern heatwave lands on turn 9. Green space and water rationing are the levers; keep heat deaths at or under 215.",
    seed: 8,
    tip: "Green space near 40 halves heat exposure; ration_water cuts the death rate 30%.",
    goals: { maxHeatwaveDeaths: 215 },
    ...trialBudgets([
      "turn-9 heatwave",
      "215-death cap",
      "green timing",
      "ration discipline",
    ]),
    story: [
      "Southside bakes under a white sky; the grid groans by noon each day.",
      "The turn-9 heatwave is already on the charts, and it is a big one.",
      "Keep heat deaths at or under 215 through the long hot end.",
    ],
  },
  {
    kind: "city",
    id: "pound-for-pound",
    title: "Pound for pound",
    brief:
      "The auditors divide every dollar and token out of the score. Same city, same shocks — post efficiency 14.5 or better on the cheapest lives.",
    seed: 9,
    tip: "Rescue-heavy wins matches but bleeds the denominator — find the cheapest lives you can.",
    goals: { minEfficiency: 14.5 },
    ...trialBudgets(["efficiency denominator", "spend discipline", "token discipline"]),
    story: [
      "The auditors arrive with empty ledgers and sharp pencils.",
      "Every dollar spent and every token burned will divide the final score.",
      "Post efficiency 14.5 or better — cheap lives only.",
    ],
  },
  {
    kind: "city",
    id: "skinflint",
    title: "Skinflint steward",
    brief:
      "Treasury hands over $1.05M for twelve shock-season turns. Stay under the cap, hold impact 40+, and never overfill reserves past $240k.",
    seed: 9,
    tip: "Reserves are savings, not spending — but anything over the $240k cap is pure waste.",
    goals: { maxSpend: 1050000, minImpact: 40 },
    ...trialBudgets(["$1.05M cap", "impact floor", "reserve-cap trap", "shock season"]),
    story: [
      "The treasury locks its vault and hands you a thin envelope.",
      "One city, twelve turns, barely a million dollars to spend.",
      "Stay under $1.05M without letting impact slide below 40.",
    ],
  },
  {
    kind: "city",
    id: "worst-street",
    title: "Worst street in town",
    brief:
      "The harshest seed in the book: twin shocks and mean draws. Fund housing, infra, and green before trouble lands — score 47 or better.",
    seed: 12,
    tip: "Pre-position before both shocks: housing and infra blunt the flood, green blunts the heat.",
    goals: { minImpact: 47 },
    ...trialBudgets([
      "harshest seed",
      "twin shocks",
      "mean draws",
      "pre-positioning",
      "impact-47 bar",
    ]),
    story: [
      "They call it the worst street in town, and the charts agree.",
      "Two shocks, mean draws, no soft landing anywhere in twelve turns.",
      "Score 47 or better on the harshest seed in the book.",
    ],
  },
  {
    kind: "city",
    id: "fifth-alarm",
    title: "Fifth alarm",
    brief:
      "A flood plus the fiercest heatwave on record. Ration water through the turn-9 crisis, pre-cool with green, rescue after — hold deaths to 1,080.",
    seed: 5,
    tip: "Run ration_water through the whole turn-9 crisis and keep green near 40; rescue cleans up after.",
    goals: { maxHeatwaveDeaths: 1080 },
    ...trialBudgets([
      "flood plus fiercest heat",
      "1,080-death cap",
      "two-front sequencing",
      "pre-cool",
      "ration run",
      "rescue cleanup",
    ]),
    story: [
      "First the river, then the sky: a flood and the fiercest heatwave on record.",
      "The fifth alarm rings for both — the city has never faced the pair.",
      "Hold heat deaths to 1,080 through fire and water alike.",
    ],
  },
  {
    kind: "city",
    id: "tenth-bell",
    title: "Tenth bell",
    brief:
      "Late heat arrives all at once with the budget half spent. Pre-cool early, ration through the spike, cap deaths at 925.",
    seed: 10,
    tip: "Pre-cool with green before turn 9, then ration_water while the crisis burns.",
    goals: { maxHeatwaveDeaths: 925 },
    ...trialBudgets([
      "late heat spike",
      "925-death cap",
      "half-spent budget",
      "pre-cool timing",
    ]),
    story: [
      "Seed 10 smoulders for eight turns, then the tenth bell tolls.",
      "The late heat arrives all at once, with the budget already half gone.",
      "Cap heat deaths at 925 without torching what remains.",
    ],
  },
  {
    kind: "city",
    id: "westside-audit",
    title: "Westside audit",
    brief:
      "The wall trial's flood, but the auditors came too. Buy only the cheapest lives and post efficiency 14.5 or better.",
    seed: 11,
    tip: "Rescue wins matches but bleeds the denominator — buy only the cheapest lives on this seed.",
    goals: { minEfficiency: 14.5 },
    ...trialBudgets(["flood seed", "efficiency bar", "cheapest-lives routing"]),
    story: [
      "Back to the seed of the wall-trial — but this time the auditors came too.",
      "Same flood, same city, and a ledger that punishes every rescue dollar.",
      "Post efficiency 14.5 or better on the westside flood.",
    ],
  },
];

export interface GoalCheck {
  label: string;
  passed: boolean;
  actual: string;
}

function fmtMoney(value: number): string {
  return `$${Math.round(value).toLocaleString("en-US")}`;
}

export function goalSummary(challenge: Challenge): string {
  const parts: string[] = [`Seed ${String(challenge.seed)}`];
  const goals = challenge.goals;
  if (goals.minImpact !== undefined && goals.minImpact > 0) {
    parts.push(`Impact ≥ ${String(goals.minImpact)}`);
  }
  if (goals.minEfficiency !== undefined) {
    parts.push(`Efficiency ≥ ${goals.minEfficiency.toFixed(1)}`);
  }
  if (goals.maxSpend !== undefined) {
    parts.push(`Spend ≤ ${fmtMoney(goals.maxSpend)}`);
  }
  if (goals.maxTokens !== undefined) {
    parts.push(`Tokens ≤ ${goals.maxTokens.toLocaleString("en-US")}`);
  }
  if (goals.maxHeatwaveDeaths !== undefined) {
    parts.push(`Heat deaths ≤ ${goals.maxHeatwaveDeaths.toLocaleString("en-US")}`);
  }
  if (goals.minPackScore !== undefined) {
    parts.push(`Pack score ≥ ${String(goals.minPackScore)}`);
  }
  if (parts.length === 1) {
    parts.push("Finish the match");
  }
  return parts.join(" · ");
}

export function evaluateChallenge(
  challenge: Challenge,
  result: MatchResultPayload,
): GoalCheck[] {
  const checks: GoalCheck[] = [];
  const goals = challenge.goals;
  if (goals.minImpact !== undefined) {
    const actual = result.scores.impact ?? 0;
    checks.push({
      label:
        goals.minImpact === 0
          ? "Finish the match"
          : `Impact ≥ ${String(goals.minImpact)}`,
      passed: actual >= goals.minImpact,
      actual: actual.toFixed(2),
    });
  }
  if (goals.minEfficiency !== undefined) {
    const actual = result.scores.efficiency ?? 0;
    checks.push({
      label: `Efficiency ≥ ${goals.minEfficiency.toFixed(1)}`,
      passed: actual >= goals.minEfficiency,
      actual: actual.toFixed(2),
    });
  }
  if (goals.maxSpend !== undefined) {
    const actual = result.totals.spend ?? 0;
    checks.push({
      label: `Spend ≤ ${fmtMoney(goals.maxSpend)}`,
      passed: actual <= goals.maxSpend,
      actual: fmtMoney(actual),
    });
  }
  if (goals.maxTokens !== undefined) {
    const actual = result.totals.tokens_used ?? 0;
    checks.push({
      label: `Tokens ≤ ${goals.maxTokens.toLocaleString("en-US")}`,
      passed: actual <= goals.maxTokens,
      actual: Math.round(actual).toLocaleString("en-US"),
    });
  }
  if (goals.maxHeatwaveDeaths !== undefined) {
    const actual = result.totals.lives_lost_heatwave ?? 0;
    checks.push({
      label: `Heat deaths ≤ ${goals.maxHeatwaveDeaths.toLocaleString("en-US")}`,
      passed: actual <= goals.maxHeatwaveDeaths,
      actual: Math.round(actual).toLocaleString("en-US"),
    });
  }
  return checks;
}

export function challengePassed(checks: GoalCheck[]): boolean {
  return checks.length > 0 && checks.every((check) => check.passed);
}

/**
 * Tote packing trials: the unified simulation interleaves one after every
 * city trial; the crane packs the levitating tote on stage. Bars sit
 * below a clean full-value pack (the tote grader tops out at the
 * catalog's total value plus condition bonuses).
 */
export const TOTE_CHALLENGES: Challenge[] = [
  {
    kind: "tote",
    id: "market-day",
    title: "Market day tote",
    brief:
      "A drop-in packing task on seed 3: the crane loads the tote while the market watches. Call the stacking order, bottom first — pack score of 30 or better.",
    seed: 3,
    tip: "Heavy low, fragile high, liquids away from fabric — value density wins ties.",
    goals: { minPackScore: 30 },
    ...trialBudgets([
      "bottom-up ordering",
      "fragile-on-top",
      "liquid/fabric split",
      "scarce bonus",
      "free slots",
    ]),
    story: [
      "Between city crises, the market crew needs one tote packed right.",
      "The crane is warmed up and the trailer is already levitating.",
      "Call the packing order — score 30 or better takes the day.",
    ],
  },
  {
    kind: "tote",
    id: "fragile-cargo",
    title: "Fragile cargo",
    brief:
      "Seed 7 brings the breakables: clinic glassware on the regular market run. Cushion with soft goods, crack nothing — score 45 or better.",
    seed: 7,
    tip: "Fragile items ride on top, cushioned by soft goods; never under tools.",
    goals: { minPackScore: 45 },
    ...trialBudgets([
      "breakable offer",
      "cushioning order",
      "crack-nothing bar",
      "score-45 bar",
    ]),
    story: [
      "A crate of clinic glassware joins the usual market run on seed 7.",
      "One cracked vial and the steward hears about it for a week.",
      "Pack gently, score 45 or better, crack nothing.",
    ],
  },
];

/**
 * Prompting drills: always-open practice on known seeds, outside
 * the ranked chain. Each teaches one move — rewriting a flawed
 * draft, compressing, changing one clause at a time, planning both
 * shocks, moving a prompt between models. Bars sit between the
 * fixed baseline and the rescue-heavy reference (see the header
 * calibration), so a sharp rewrite clears them and the draft you
 * are handed does not.
 */
export const DRILLS: Challenge[] = [
  {
    kind: "city",
    id: "drill-fix",
    title: "Fix the leak",
    brief:
      "The draft below ran the seed-11 flood at baseline pace — it spends early, names no numbers, and plans nothing. Rewrite it: same seed, your words, impact 53 or better.",
    seed: 11,
    tip: "Numbers, a reserve floor, and an if-flood rule. Watch the craft checklist climb as you rewrite.",
    goals: { minImpact: 53 },
    ...trialBudgets(["severity-5 flood", "west exposure", "shelter timing"]),
    story: [
      "A predecessor's draft goes up on the board, red ink and all.",
      "It spends early, names no numbers, and hopes the river behaves.",
      "Rewrite it — hold the west wall at impact 53 or better.",
    ],
    starterPrompt:
      "Spend everything on housing right away, it matters most. Make the city beautiful with lots of green. If anything goes wrong, deal with it then. Be thorough and explain your reasoning at length every turn.",
  },
  {
    kind: "city",
    id: "drill-eighty",
    title: "Eighty words",
    brief:
      "The turn-9 heatwave, in eighty words or fewer. Keep heat deaths at or under 230 — every word must earn its place.",
    seed: 8,
    tip: "Compression is a decision: cut adjectives before you cut instructions.",
    goals: { maxHeatwaveDeaths: 230 },
    ...trialBudgets(["turn-9 heatwave", "green timing", "ration discipline"]),
    words: 80,
    story: [
      "The southside heat is coming and the telegraph charges by the word.",
      "Eighty words to save a district: choose like a poet with a budget.",
      "Keep heat deaths at or under 230.",
    ],
  },
  {
    kind: "city",
    id: "drill-one-clause",
    title: "One clause at a time",
    brief:
      "Seed 9 grades efficiency. Run it, change ONE clause, rerun the same seed — the aftermath and version graph price every clause. Post efficiency 14.2 or better.",
    seed: 9,
    tip: "One variable per experiment. Two changes teach you nothing about either.",
    goals: { minEfficiency: 14.2 },
    ...trialBudgets(["efficiency denominator", "spend discipline"]),
    story: [
      "The auditors return, pencils sharper than ever.",
      "Same city, same seed — only your clause may move.",
      "Post efficiency 14.2 or better, one clause at a time.",
    ],
  },
  {
    kind: "city",
    id: "drill-two-shocks",
    title: "Two shocks, one plan",
    brief:
      "The harshest seed in the book lands both shocks. Write the turn-5 and turn-9 answers into the prompt before you run — hold impact 46 or better.",
    seed: 12,
    tip: "A contingency written is a decision already made: if-flood and if-heat, both funded.",
    goals: { minImpact: 46 },
    ...trialBudgets(["severity-5 flood", "turn-9 heatwave", "reserve floor"]),
    story: [
      "Twin sirens on the forecast: water first, then the long heat.",
      "Improvised stewards drown at turn 5 and bake at turn 9.",
      "Write both answers down — hold impact 46 or better.",
    ],
  },
  {
    kind: "city",
    id: "drill-transfer",
    title: "Local hands, hosted hands",
    brief:
      "Same quiet city, two minds: run this prompt on a local model, then Retry with another model on a hosted one. Any valid run clears it — the lesson is the token-burn comparison in the record.",
    seed: 1,
    tip: "Prompts are portable; habits are not. Watch what each model does with the same words.",
    goals: { minImpact: 0 },
    ...trialBudgets(["orientation", "model transfer"]),
    story: [
      "Two stewards apply for one job, same letter of introduction.",
      "The local hand knows the streets; the hosted hand knows the books.",
      "Finish a run with each — the record keeps both receipts.",
    ],
  },
];

/** Drills are practice: always unlocked, never chain gates. */
export function isDrillChallenge(id: string): boolean {
  return DRILLS.some((entry) => entry.id === id);
}

/** Any playable task by id: ranked city chain or tote drop-in. */
export function challengeById(id: string): Challenge | undefined {
  const direct =
    CHALLENGES.find((entry) => entry.id === id) ??
    DRILLS.find((entry) => entry.id === id) ??
    TOTE_CHALLENGES.find((entry) => entry.id === id);
  if (direct !== undefined) return direct;
  const endless = parseEndlessId(id);
  if (endless === null) return undefined;
  const base =
    CHALLENGES.find((entry) => entry.id === endless.baseId) ??
    TOTE_CHALLENGES.find((entry) => entry.id === endless.baseId);
  return base === undefined ? undefined : endlessVariant(base, endless.cycle);
}

const ENDLESS_SEED_STEP = 7919;

/**
 * Endless replay of a cleared challenge: a fresh city every cycle.
 * The first replay keeps the base bars; from cycle 2 the chase is
 * on — minimums rise 3% and maximums tighten 3% per cycle cleared,
 * so the bar a steward faces is always one step past their own best
 * on that trial. Finish-the-match trials (bar 0) stay finish-only.
 */
export function endlessVariant(base: Challenge, cycle: number): Challenge {
  const step = Math.max(0, cycle - 1);
  const up = (value: number): number => Math.round(value * (1 + 0.03 * step) * 10) / 10;
  const down = (value: number): number => Math.round(value * (1 - 0.03 * step));
  const goals: ChallengeGoals = { ...base.goals };
  if (goals.minImpact !== undefined && goals.minImpact > 0) {
    goals.minImpact = up(goals.minImpact);
  }
  if (goals.minEfficiency !== undefined) {
    goals.minEfficiency = up(goals.minEfficiency);
  }
  if (goals.minPackScore !== undefined) {
    goals.minPackScore = up(goals.minPackScore);
  }
  if (goals.maxSpend !== undefined) {
    goals.maxSpend = down(goals.maxSpend);
  }
  if (goals.maxTokens !== undefined) {
    goals.maxTokens = down(goals.maxTokens);
  }
  if (goals.maxHeatwaveDeaths !== undefined) {
    goals.maxHeatwaveDeaths = down(goals.maxHeatwaveDeaths);
  }
  return {
    ...base,
    goals,
    id: `${base.id}~endless${String(cycle)}`,
    title: `${base.title} — endless ${String(cycle)}`,
    seed: base.seed + cycle * ENDLESS_SEED_STEP,
  };
}

/** Parse an endless variant id back to its base and cycle. */
export function parseEndlessId(id: string): { baseId: string; cycle: number } | null {
  const match = /^(.+)~endless(\d+)$/.exec(id);
  if (match === null) return null;
  const cycle = Number.parseInt(match[2] ?? "0", 10);
  if (!Number.isInteger(cycle) || cycle < 1) return null;
  return { baseId: match[1] ?? "", cycle };
}

/** Endless variants unlock once their base challenge is cleared. */
export function isEndlessUnlocked(id: string, clearedIds: readonly string[]): boolean {
  const endless = parseEndlessId(id);
  return endless !== null && clearedIds.includes(endless.baseId);
}

/**
 * Next endless cycle for one cleared base: one past the highest
 * recorded cycle (or 1 when the base was cleared but never
 * replayed). Completions carry endless ids once replayed, so the
 * cycle count survives reloads.
 */
export function nextEndlessCycle(
  baseId: string,
  completions: Record<string, Completion>,
): number {
  let top = 0;
  for (const id of Object.keys(completions)) {
    const parsed = parseEndlessId(id);
    if (parsed !== null && parsed.baseId === baseId && parsed.cycle > top) {
      top = parsed.cycle;
    }
  }
  return top + 1;
}

/** Goal checks for a finished tote pack. */
export function evaluateToteChallenge(
  challenge: Challenge,
  result: { score: number },
): GoalCheck[] {
  if (challenge.goals.minPackScore === undefined) {
    return [];
  }
  return [
    {
      label: `Pack score ≥ ${String(challenge.goals.minPackScore)}`,
      passed: result.score >= challenge.goals.minPackScore,
      actual: result.score.toFixed(2),
    },
  ];
}

/**
 * Tote pack score that counts as a perfect unified run. The
 * fragile-cargo bar is the hardest posted tote goal, so clearing it
 * is a 100; the grader's observed ceiling sits just above par.
 */
export const TOTE_SCORE_PAR = 45;

/** Tote pack score on the unified 0-100 run scale. */
export function toteNorm100(score: number): number {
  if (!Number.isFinite(score)) {
    return 0;
  }
  return Math.min(100, Math.max(0, (score / TOTE_SCORE_PAR) * 100));
}

/**
 * Unified run score for one stored completion. New tote clears
 * stamp kind + raw and read impact directly; legacy tote clears
 * (raw pack score in impact, no kind) normalize on the way out.
 */
export function unifiedImpact(id: string, done: Completion): number {
  if (done.kind !== undefined) {
    return done.impact;
  }
  const baseId = parseEndlessId(id)?.baseId ?? id;
  if (TOTE_CHALLENGES.some((entry) => entry.id === baseId)) {
    return toteNorm100(done.impact);
  }
  return done.impact;
}

/**
 * The tote trial for unified slot k: the two drop-ins take turns,
 * replaying as endless variants past the first cycle. Cycle 1 keeps
 * the posted bars on a fresh seed; later cycles tighten per the
 * endless rule.
 */
function toteSlot(slot: number): Challenge | undefined {
  const base = TOTE_CHALLENGES[slot % TOTE_CHALLENGES.length];
  if (base === undefined) {
    return undefined;
  }
  const cycle = Math.floor(slot / TOTE_CHALLENGES.length);
  return cycle === 0 ? base : endlessVariant(base, cycle);
}

/**
 * One simulation, alternating trials: city, tote, city, tote — each city
 * trial followed by its packing shift. Built once so every view
 * shares the same entry identities.
 */
export const UNIFIED_CHAIN: readonly Challenge[] = CHALLENGES.flatMap((city, index) => {
  const tote = toteSlot(index);
  return tote === undefined ? [city] : [city, tote];
});

/**
 * Unlock rule for the unified simulation: chain order is array order, like
 * the city chain before it. Endless ids outside the chain open once
 * their base is cleared.
 */
export function isUnifiedUnlocked(id: string, clearedIds: readonly string[]): boolean {
  const index = UNIFIED_CHAIN.findIndex((entry) => entry.id === id);
  if (index < 0) {
    return isEndlessUnlocked(id, clearedIds);
  }
  if (index === 0) {
    return true;
  }
  const previous = UNIFIED_CHAIN[index - 1];
  return previous !== undefined && clearedIds.includes(previous.id);
}

/** Unified trials the player may see: unlocked ones only, locked hidden. */
export function unifiedUnlocked(clearedIds: readonly string[]): Challenge[] {
  return UNIFIED_CHAIN.filter((entry) => isUnifiedUnlocked(entry.id, clearedIds));
}

/**
 * The trial the simulation offers next: the first uncleared entry in
 * unified order. Past the chain, strict alternation continues
 * forever — city, tote, city — rotating bases with rising cycles.
 */
export function nextUnifiedPlay(
  completions: Record<string, Completion>,
): Challenge | undefined {
  const clearedIds = Object.keys(completions);
  const next = UNIFIED_CHAIN.find((entry) => !clearedIds.includes(entry.id));
  if (next !== undefined) {
    return next;
  }
  // The chain ends on a packing shift, so the tail leads with a
  // city and alternates by kind counts — self-balancing past skips.
  const chainIds = new Set(UNIFIED_CHAIN.map((entry) => entry.id));
  let tailCity = 0;
  let tailTote = 0;
  for (const id of clearedIds) {
    if (chainIds.has(id)) {
      continue;
    }
    const parsed = parseEndlessId(id);
    if (parsed === null) {
      continue;
    }
    if (CHALLENGES.some((entry) => entry.id === parsed.baseId)) {
      tailCity += 1;
    } else if (TOTE_CHALLENGES.some((entry) => entry.id === parsed.baseId)) {
      tailTote += 1;
    }
  }
  if (tailCity <= tailTote) {
    const base = CHALLENGES[tailCity % CHALLENGES.length];
    if (base === undefined) {
      return undefined;
    }
    return endlessVariant(base, nextEndlessCycle(base.id, completions));
  }
  const base = TOTE_CHALLENGES[tailTote % TOTE_CHALLENGES.length];
  if (base === undefined) {
    return undefined;
  }
  return endlessVariant(base, nextEndlessCycle(base.id, completions));
}

/**
 * First-clear auto-advance: when the selected task just cleared —
 * its id is new in completions — the console brings up the next
 * unified play. Re-clears (same keys, better score), manual picks
 * of old clears, and open play return null: the form stays put.
 */
export function nextPickAfterClear(
  completions: Record<string, Completion>,
  previousIds: readonly string[],
  selectedId: string,
): string | null {
  if (selectedId === "") {
    return null;
  }
  const prev = new Set(previousIds);
  const fresh = Object.keys(completions).filter((id) => !prev.has(id));
  if (!fresh.includes(selectedId)) {
    return null;
  }
  const next = nextUnifiedPlay(completions);
  if (next === undefined || next.id === selectedId) {
    return null;
  }
  return next.id;
}

export interface UnifiedSummary {
  cleared: number;
  total: number;
  /** Endless cycles cleared past the chain, either shift. */
  endless: number;
  /** Best unified run score across every recorded clear. */
  bestUnified: number | null;
}

/** Local progress rollup for the unified simulation; unknown ids ignored. */
export function summarizeUnified(
  completions: Record<string, Completion>,
): UnifiedSummary {
  let bestUnified: number | null = null;
  for (const [id, done] of Object.entries(completions)) {
    const score = unifiedImpact(id, done);
    bestUnified = bestUnified === null ? score : Math.max(bestUnified, score);
  }
  const endless = Object.keys(completions).filter((id) => {
    const parsed = parseEndlessId(id);
    return (
      parsed !== null &&
      (CHALLENGES.some((entry) => entry.id === parsed.baseId) ||
        TOTE_CHALLENGES.some((entry) => entry.id === parsed.baseId))
    );
  }).length;
  return {
    cleared: UNIFIED_CHAIN.filter((entry) => completions[entry.id] !== undefined)
      .length,
    total: UNIFIED_CHAIN.length,
    endless,
    bestUnified,
  };
}
