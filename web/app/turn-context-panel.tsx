/**
 * Turn context panel – combines Turn Brief with live animation hints.
 * Shows users why this turn matters and how the stage will react.
 */

import TurnBrief from "./turn-brief";
import { useMatch } from "./use-match";
import { useHistory } from "./use-history";

export default function TurnContextPanel() {
  const historyApi = useHistory();
  const { activeTurn, result } = useMatch(historyApi);
  const turn = result?.turns[activeTurn - 1];

  return (
    <section className="turn-context">
      <TurnBrief turnNo={activeTurn} turn={turn} />
      <div className="stage-hint">
        <h4>How the stage animates</h4>
        <ul>
          <li>Tower height scales with your allocation share for each budget key.</li>
          <li>Windows light up with health + reserves spend.</li>
          <li>
            Crisis visuals: flood water rises, heat glow intensifies, seismic shiver.
          </li>
          <li>Directives appear as subtle pulsing on the relevant site.</li>
        </ul>
      </div>
    </section>
  );
}
