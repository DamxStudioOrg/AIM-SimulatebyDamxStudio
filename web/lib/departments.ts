/**
 * What each city department converts money into. Rates come straight
 * from the sim's investment math (simulator.py) at base quarterly
 * income ($120k, so 10% is $12,000 a turn): per-10% effects, caps,
 * waste rules, and crisis roles. Keep this beside the sim's
 * ALLOCATION_KEYS — eight entries, same ids, same order.
 */

export interface DepartmentBrief {
  id: string;
  label: string;
  /** What 10% of income buys this department each turn. */
  per10: string;
  /** Caps, waste rules, and crisis behavior. */
  detail: string;
}

export const DEPARTMENT_BRIEFS: readonly DepartmentBrief[] = [
  {
    id: "housing",
    label: "Housing",
    per10: "+0.32 coverage",
    detail: "Caps at 100 (starts 65). Coverage plus infra soften shock displacement.",
  },
  {
    id: "transit",
    label: "Transit",
    per10: "+0.04 level",
    detail:
      "Caps at 5.0 (starts 2.0). −0.24 emissions landing 3 turns later; −0.15 approval now.",
  },
  {
    id: "health",
    label: "Health",
    per10: "+13 capacity",
    detail:
      "Starts 400. Capacity multiplies every rescue dollar: ×(1 + capacity/1200).",
  },
  {
    id: "green",
    label: "Green",
    per10: "+0.11 green",
    detail: "Caps at 40 (starts 10). Feeds the wellbeing index.",
  },
  {
    id: "reserves",
    label: "Reserves",
    per10: "+$12,000 saved",
    detail:
      "Caps at $240k (2× income) — overcap is wasted. Covers shortfalls before debt.",
  },
  {
    id: "rescue",
    label: "Rescue",
    per10: "≈54 lives",
    detail: "$220 per life, ×1.5 with medics. Idle without a crisis is wasted.",
  },
  {
    id: "shelter",
    label: "Shelter",
    per10: "≈46 rehoused",
    detail: "$260 per person, ×2 with open shelters. Idle without a crisis is wasted.",
  },
  {
    id: "repair",
    label: "Repair",
    per10: "+1.3 infra",
    detail: "$9,000 per infra point, ×1.6 under mutual aid. +0.15 upkeep even idle.",
  },
];

/** The city as the prompt finds it on turn 1. */
export const OPENING_STATE =
  "Turn 1 opens with ≈$122k quarterly income, $60k reserves, approval 60, " +
  "housing 65%, transit 2.0 of 5, health capacity 400, green 10%, district " +
  "infra 90%.";

/** How allocation percent becomes dollars each turn. */
export const INCOME_NOTE =
  "Every non-reserves percent spends off that quarter's income; reserves " +
  "percent is saved instead. Shocks land on turns 5 (flood) and 9 " +
  "(heatwave or infra failure), each opening a 3-turn crisis window.";
