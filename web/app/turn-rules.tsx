import { OUTPUT_RULES, POLICY_CARDS, SAMPLE_PLAYS, TURN_RULES } from "@/lib/rules";
import CopyButton from "./copy-button";

export default function TurnRules({
  highlight,
}: Readonly<{ highlight?: number | null }>): React.ReactElement {
  return (
    <div className="rules">
      <h3>Turn-by-turn playbook</h3>
      <table>
        <thead>
          <tr>
            <th scope="col" className="num">
              Turn
            </th>
            <th scope="col">Phase</th>
          </tr>
        </thead>
        <tbody>
          {TURN_RULES.map((rule) => (
            <tr
              key={rule.turn}
              className={rule.turn === highlight ? "rule-active" : undefined}
            >
              <th scope="row" className="num">
                {rule.turn}
              </th>
              <td>
                <span className={`phase phase-${rule.phase}`}>{rule.phase}</span>
                <span className="rule-event">{rule.event}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <h3>Every-turn output contract</h3>
      <ul className="tight">
        {OUTPUT_RULES.map((rule) => (
          <li key={rule.slice(0, 32)}>{rule}</li>
        ))}
      </ul>
      <h3>Policy price list</h3>
      <ul className="tight">
        {POLICY_CARDS.map((card) => (
          <li key={card.name}>
            <code>{card.name}</code> · {card.cost} · {card.effect}
          </li>
        ))}
      </ul>
      <h3>Sample simulations by phase</h3>
      <p className="hint">
        Copy a shape into your prompt as the model&apos;s target output, then tune the
        numbers. Every sample already sums to exactly 100.
      </p>
      {SAMPLE_PLAYS.map((play) => (
        <div key={play.phase} className="sample">
          <div className="sample-head">
            <span className={`phase phase-${play.phase}`}>{play.phase}</span>
            <CopyButton text={play.json} />
          </div>
          <pre className="sample-code">
            <code>{play.json}</code>
          </pre>
        </div>
      ))}
    </div>
  );
}
