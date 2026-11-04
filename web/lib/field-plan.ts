/** Steward field plans: up to 3 interventions, at most one per turn. */

export interface FieldIntervention {
  turn: number;
  kind: string;
}

export const FIELD_PLAN_MAX = 3;
export const FIELD_PLAN_TURNS = 12;

export const INTERVENTION_KINDS = ["irrigate", "vent_heat", "terrace"] as const;
export type InterventionKind = (typeof INTERVENTION_KINDS)[number];

const INTERVENTION_LABELS: Record<InterventionKind, string> = {
  irrigate: "Irrigation",
  vent_heat: "Vent heat",
  terrace: "Terracing",
};

export interface InterventionGuide {
  /** Plain-words effect, quoted from the sim's terrain shifts. */
  effect: string;
  /** When a steward reaches for it. */
  when: string;
}

/**
 * What each intervention does to the land, in the sim's own numbers
 * (terraform `_INTERVENTION_SHIFT`): the field panel shows this so a
 * pick is a decision, not a guess.
 */
export const INTERVENTION_GUIDE: Record<InterventionKind, InterventionGuide> = {
  irrigate: {
    effect: "+12 moisture on every live site",
    when: "before a dry or heat-struck stretch",
  },
  vent_heat: {
    effect: "−14 heat on every live site",
    when: "ahead of the turn-9 heat shock",
  },
  terrace: {
    effect: "−10 erosion on every live site",
    when: "ahead of flood turns, so slopes hold",
  },
};

/** Guide for a kind id, or null for ids the sim would reject. */
export function interventionGuide(kind: string): InterventionGuide | null {
  return isInterventionKind(kind) ? INTERVENTION_GUIDE[kind] : null;
}

export function isInterventionKind(value: string): value is InterventionKind {
  return (INTERVENTION_KINDS as readonly string[]).includes(value);
}

/** Display label for a kind id; unknown ids pass through untouched. */
export function interventionLabel(kind: string): string {
  if (!isInterventionKind(kind)) {
    return kind;
  }
  return INTERVENTION_LABELS[kind];
}

export interface FieldPlanUpdate {
  plan: FieldIntervention[];
  error: string | null;
}

export function addFieldEntry(
  plan: FieldIntervention[],
  turn: number,
  kind: string,
): FieldPlanUpdate {
  if (!Number.isInteger(turn) || turn < 1 || turn > FIELD_PLAN_TURNS) {
    return { plan, error: "Turn must be between 1 and 12." };
  }
  if (!isInterventionKind(kind)) {
    return { plan, error: "Unknown intervention." };
  }
  if (plan.some((entry) => entry.turn === turn)) {
    return { plan, error: `Turn ${String(turn)} already has an intervention.` };
  }
  if (plan.length >= FIELD_PLAN_MAX) {
    return { plan, error: "Field plan is full — remove one first." };
  }
  const next = [...plan, { turn, kind }].sort((a, b) => a.turn - b.turn);
  return { plan: next, error: null };
}

export function removeFieldEntry(
  plan: FieldIntervention[],
  turn: number,
): FieldIntervention[] {
  return plan.filter((entry) => entry.turn !== turn);
}
