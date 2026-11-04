import { useState } from "react";
import { Button } from "@/components/base/buttons/button";
import {
  FIELD_PLAN_MAX,
  FIELD_PLAN_TURNS,
  INTERVENTION_KINDS,
  addFieldEntry,
  interventionGuide,
  interventionLabel,
  removeFieldEntry,
} from "@/lib/field-plan";
import type { FieldIntervention } from "@/lib/field-plan";

interface FieldPlanPanelProps {
  plan: FieldIntervention[];
  onChange: (plan: FieldIntervention[]) => void;
  disabled: boolean;
  idPrefix: string;
}

/**
 * Prepare the land (the field plan): up to 3 land moves filed with
 * the run. Each fires at the start of its turn, before the model
 * moves, and costs nothing from the prompt or token budget — this
 * is the steward's hand on the terrain itself, not the prompt's.
 */
export default function FieldPlanPanel({
  plan,
  onChange,
  disabled,
  idPrefix,
}: FieldPlanPanelProps): React.ReactElement {
  const [turnText, setTurnText] = useState("5");
  const [kind, setKind] = useState<string>(INTERVENTION_KINDS[0]);
  const [error, setError] = useState<string | null>(null);

  function addEntry(): void {
    const next = addFieldEntry(plan, Number.parseInt(turnText, 10), kind);
    setError(next.error);
    if (next.error === null) {
      onChange(next.plan);
    }
  }

  const guide = interventionGuide(kind);

  return (
    <section className="field-plan" aria-labelledby={`${idPrefix}-plan-heading`}>
      <h2 id={`${idPrefix}-plan-heading`}>Prepare the land (optional)</h2>
      <p className="hint">
        Shape the terrain itself — separate from your prompt. File up to{" "}
        {FIELD_PLAN_MAX} land moves; each fires at the start of its turn, before the
        model moves, and spends none of your words or tokens. Leave it empty to play the
        trial as given.
      </p>
      <p className="hint">
        When: shocks land on turns 5 and 9, so a move on turn 4 or 8 sets the land up
        first. One move per turn.
      </p>
      <label htmlFor={`${idPrefix}-plan-turn`}>Turn (1–{FIELD_PLAN_TURNS})</label>
      <select
        id={`${idPrefix}-plan-turn`}
        value={turnText}
        disabled={disabled}
        onChange={(event) => {
          setTurnText(event.target.value);
        }}
      >
        {Array.from({ length: FIELD_PLAN_TURNS }, (_, index) => {
          const turn = String(index + 1);
          const taken = plan.some((entry) => entry.turn === index + 1);
          return (
            <option key={turn} value={turn} disabled={taken}>
              Turn {turn}
              {taken ? " — planned" : ""}
            </option>
          );
        })}
      </select>
      <label htmlFor={`${idPrefix}-plan-kind`}>Land move</label>
      <select
        id={`${idPrefix}-plan-kind`}
        value={kind}
        disabled={disabled}
        onChange={(event) => {
          setKind(event.target.value);
        }}
      >
        {INTERVENTION_KINDS.map((entry) => {
          const entryGuide = interventionGuide(entry);
          return (
            <option key={entry} value={entry}>
              {interventionLabel(entry)}
              {entryGuide === null ? "" : ` — ${entryGuide.effect}`}
            </option>
          );
        })}
      </select>
      {guide !== null && (
        <p className="hint" role="status">
          {interventionLabel(kind)}: {guide.effect} — reach for it {guide.when}.
        </p>
      )}
      <Button
        variant="secondary"
        size="small"
        disabled={disabled || plan.length >= FIELD_PLAN_MAX}
        onClick={addEntry}
      >
        Add to plan
      </Button>
      {error !== null && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {plan.length > 0 && (
        <ul className="tight">
          {plan.map((entry) => {
            const entryGuide = interventionGuide(entry.kind);
            return (
              <li key={entry.turn}>
                Turn {entry.turn} — {interventionLabel(entry.kind)}
                {entryGuide === null ? "" : ` (${entryGuide.effect})`}{" "}
                <Button
                  variant="ghost"
                  size="xs"
                  disabled={disabled}
                  onClick={() => {
                    onChange(removeFieldEntry(plan, entry.turn));
                  }}
                >
                  Remove
                </Button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
