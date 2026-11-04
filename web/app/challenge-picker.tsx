"use client";

import { goalSummary } from "@/lib/challenges";
import type { Challenge, Completion } from "@/lib/challenges";

/**
 * The console's one task picker: every unlocked trial in unified
 * order with its clear mark, simulation shift, and goals. No open
 * play — the steward always runs the trial they're given. Shared by
 * both play modes — the section below it swaps city and tote forms
 * around the single selection. The hint under the label states the
 * rhythm up front: city trials and tote packs alternate down one
 * chain, drills are practice and never gate it.
 */
export default function ChallengePicker({
  value,
  unlocked,
  completions,
  onPick,
  drills = [],
}: Readonly<{
  value: string;
  unlocked: readonly Challenge[];
  completions: Record<string, Completion>;
  onPick: (id: string) => void;
  /** Always-open prompting drills, listed under their own group. */
  drills?: readonly Challenge[];
}>): React.ReactElement {
  const optionFor = (challenge: Challenge): React.ReactElement => (
    <option key={challenge.id} value={challenge.id}>
      {completions[challenge.id] !== undefined ? "✓ " : ""}
      {challenge.kind === "city" ? "City" : "Tote"} · {challenge.title} —{" "}
      {goalSummary(challenge)}
    </option>
  );
  return (
    <>
      <label htmlFor="challenge">Task (fixed seed, limits, and goals)</label>
      <p className="hint">
        City trials and tote packs alternate down one endless chain — cleared trials
        unlock the next. Drills sit below: always open, practice only, they never gate
        or rank.
      </p>
      <select
        id="challenge"
        value={value}
        disabled={unlocked.length === 0 && drills.length === 0}
        onChange={(event) => {
          onPick(event.target.value);
        }}
      >
        {unlocked.length === 0 && drills.length === 0 ? (
          <option value="">Loading your trial…</option>
        ) : (
          <>
            <optgroup label="Trials — chain order">{unlocked.map(optionFor)}</optgroup>
            {drills.length > 0 && (
              <optgroup label="Prompting drills — practice, no rank">
                {drills.map(optionFor)}
              </optgroup>
            )}
          </>
        )}
      </select>
    </>
  );
}
