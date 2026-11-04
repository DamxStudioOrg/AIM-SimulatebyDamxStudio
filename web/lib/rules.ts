/**
 * Turn-by-turn rules for Resilient City Steward, mirroring the simulator.
 *
 * Sources of truth: `TURN_CONTRACT.md` for the shape, `sim/src/aim_sim`
 * (`models.py` validation, `runner.py` budgets, `simulator.py` phases and
 * relief math) for the numbers. If a number here disagrees with the sim,
 * the sim wins — fix this file, never the tests.
 */

export type TurnPhase = "stewardship" | "shock" | "response" | "recovery";

export interface TurnRule {
  turn: number;
  phase: TurnPhase;
  event: string;
}

export const TURN_RULES: TurnRule[] = [
  {
    turn: 1,
    phase: "stewardship",
    event: "Open books. Income ≈ $122k; reserves start at $60k.",
  },
  {
    turn: 2,
    phase: "stewardship",
    event: "Investments compound: housing and infra soften the turn-5 blow.",
  },
  {
    turn: 3,
    phase: "stewardship",
    event: "Health capacity scales every future rescue dollar.",
  },
  {
    turn: 4,
    phase: "stewardship",
    event:
      "Forecast still reads ≈8% (±5 noise — it only spikes to ≈55% on the shock input itself, too late to reposition).",
  },
  {
    turn: 5,
    phase: "shock",
    event:
      "Flood lands in a random district, severity 2–5. This input's forecast spikes to ≈55%.",
  },
  {
    turn: 6,
    phase: "response",
    event: "Crisis active inside its 3-turn window.",
  },
  {
    turn: 7,
    phase: "response",
    event: "Unresolved at-risk residents convert to displaced when the window closes.",
  },
  {
    turn: 8,
    phase: "recovery",
    event: "Flood cleared. Rebuild window before the second shock.",
  },
  {
    turn: 9,
    phase: "shock",
    event:
      "Second shock: heatwave or infra failure, random district. Forecast spikes again.",
  },
  {
    turn: 10,
    phase: "response",
    event: "Second crisis inside its 3-turn window.",
  },
  {
    turn: 11,
    phase: "response",
    event: "Last response turn; leftovers become displaced.",
  },
  {
    turn: 12,
    phase: "recovery",
    event: "Final action, then Impact and Efficiency are scored.",
  },
];

export interface PolicyCard {
  name: string;
  cost: string;
  effect: string;
}

export const POLICY_CARDS: PolicyCard[] = [
  { name: "evacuate_district", cost: "$25,000", effect: "Death rate ×0.55 this turn." },
  { name: "open_shelters", cost: "$12,000", effect: "Shelter capacity ×2 this turn." },
  {
    name: "ration_water",
    cost: "$2,000",
    effect: "Death rate ×0.7 during a heatwave.",
  },
  {
    name: "emergency_hire_medics",
    cost: "$18,000",
    effect: "Rescue stabilizes 50% more lives this turn.",
  },
  { name: "curfew", cost: "$1,000", effect: "Death rate ×0.9; approval −2." },
  {
    name: "request_mutual_aid",
    cost: "$5,000",
    effect: "Repair throughput ×1.6 for 2 crisis turns.",
  },
];

export interface SamplePlay {
  phase: TurnPhase;
  json: string;
}

function sample(
  allocation: Record<string, number>,
  policies: string[],
  note: string,
): string {
  return JSON.stringify({ allocation, policies, note }, null, 2);
}

/** Copy-paste starting shapes per phase. Sums hold at exactly 100. */
export const SAMPLE_PLAYS: SamplePlay[] = [
  {
    phase: "stewardship",
    json: sample(
      {
        housing: 18,
        transit: 10,
        health: 20,
        green: 14,
        reserves: 18,
        rescue: 0,
        shelter: 0,
        repair: 20,
      },
      [],
      "calm quarter: invest and bank",
    ),
  },
  {
    phase: "shock",
    json: sample(
      {
        housing: 10,
        transit: 5,
        health: 15,
        green: 5,
        reserves: 0,
        rescue: 30,
        shelter: 20,
        repair: 15,
      },
      ["emergency_hire_medics", "open_shelters"],
      "the water is up: stabilize fast",
    ),
  },
  {
    phase: "response",
    json: sample(
      {
        housing: 8,
        transit: 4,
        health: 12,
        green: 3,
        reserves: 8,
        rescue: 25,
        shelter: 20,
        repair: 20,
      },
      ["request_mutual_aid"],
      "clear at-risk before the window closes",
    ),
  },
  {
    phase: "recovery",
    json: sample(
      {
        housing: 15,
        transit: 8,
        health: 12,
        green: 5,
        reserves: 30,
        rescue: 2,
        shelter: 3,
        repair: 25,
      },
      [],
      "rebuild infra and rebank reserves",
    ),
  },
];

export const OUTPUT_RULES: string[] = [
  "Reply with JSON: allocation (exactly the 8 keys, finite numbers ≥ 0, summing to 100 ± 0.01 — booleans rejected), policies (0–2 unique names from the allowlist), and an optional note (≤ 280 chars, ignored by the sim).",
  "Any violation — bad JSON, wrong keys, a bad sum, an unknown or repeated policy — skips the whole turn: zero new spend, penalty counter up, and a live crisis still bleeds lives.",
  "A rejected turn costs the turn, not tokens: over-cap or invalid output never touches the 15,000-token budget.",
  "One turn may use at most 1,200 tokens. Breach it and the turn is skipped. At zero remaining budget, every later turn is skipped.",
  "Income each turn ≈ $120k × (0.9 + wellbeing / 500). Reserves cover shortfalls, cap at $240k, and rescue/shelter spend with no crisis on the board is wasted.",
];
