"use client";

import { TURN_RULES } from "@/lib/rules";
import { DEPARTMENT_BRIEFS, INCOME_NOTE, OPENING_STATE } from "@/lib/departments";

/**
 * Department brief: what each department converts money into, per 10%
 * of income, plus the 12-turn map — the numbers behind the names the
 * prompt-craft checklist asks the draft to use. Amounts quote the
 * sim's own rates at base income; the turn map reuses the same rules
 * the replay inspector shows, so pre-run and post-run agree.
 */
export default function DepartmentBrief(): React.ReactElement {
  return (
    <details className="dept-brief">
      <summary>
        What each department wants
        <span className="hint">amounts per 10% of income, plus the turn map</span>
      </summary>
      <p>{OPENING_STATE}</p>
      <p className="hint">{INCOME_NOTE}</p>
      <table className="dept-table">
        <caption className="visually-hidden">
          Per-department conversion rates per 10% of quarterly income
        </caption>
        <thead>
          <tr>
            <th scope="col">Department</th>
            <th scope="col">10% buys</th>
            <th scope="col">Notes</th>
          </tr>
        </thead>
        <tbody>
          {DEPARTMENT_BRIEFS.map((entry) => (
            <tr key={entry.id}>
              <th scope="row">{entry.label}</th>
              <td className="num">{entry.per10}</td>
              <td>{entry.detail}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <h3 className="dept-turns-heading">The 12 turns</h3>
      <ol className="turn-map">
        {TURN_RULES.map((rule) => (
          <li key={rule.turn} data-phase={rule.phase}>
            <span className="turn-map-turn">T{rule.turn}</span>{" "}
            <span className={`phase phase-${rule.phase}`}>{rule.phase}</span>
            <span className="turn-map-event">{rule.event}</span>
          </li>
        ))}
      </ol>
      <p className="hint">
        After a run, open any turn in the replay to see what actually happened there.
      </p>
    </details>
  );
}
