import { Button } from "@/components/base/buttons/button";
import { formatDelta, ghostSeries, raceDeltas, raceVerdict } from "@/lib/ghost-race";
import type { HistoryEntry } from "@/lib/history";
import { formatHistoryWhen } from "@/lib/history";
import type { MatchResultPayload } from "@/lib/sim";

interface GhostRacePanelProps {
  ghost: HistoryEntry;
  result: MatchResultPayload | null;
  activeTurn: number;
  onClear: () => void;
}

/**
 * Live-vs-ghost race readout. Deltas are live minus ghost per turn;
 * the race only runs when both sides carry full race timing.
 */
export default function GhostRacePanel({
  ghost,
  result,
  activeTurn,
  onClear,
}: GhostRacePanelProps): React.ReactElement {
  const series = ghostSeries(ghost);
  const ghostName = `${formatHistoryWhen(ghost.when)} · seed ${String(ghost.seed)}`;

  if (series === null) {
    return (
      <section className="ghost-race" aria-labelledby="ghost-race-heading">
        <h2 id="ghost-race-heading">Ghost race</h2>
        <p className="hint" role="status">
          {ghostName} predates race timing and cannot race.
        </p>
        <Button variant="ghost" size="small" onClick={onClear}>
          Clear ghost
        </Button>
      </section>
    );
  }

  if (result === null) {
    return (
      <section className="ghost-race" aria-labelledby="ghost-race-heading">
        <h2 id="ghost-race-heading">Ghost race</h2>
        <p className="hint" role="status">
          Racing {ghostName}. Run or replay seed {ghost.seed} to start the race.
        </p>
        <Button variant="ghost" size="small" onClick={onClear}>
          Clear ghost
        </Button>
      </section>
    );
  }

  if (result.seed !== ghost.seed) {
    return (
      <section className="ghost-race" aria-labelledby="ghost-race-heading">
        <h2 id="ghost-race-heading">Ghost race</h2>
        <p className="hint" role="status">
          Racing {ghostName}, but the live run is seed {result.seed}. Run or replay seed{" "}
          {ghost.seed} to compare.
        </p>
        <Button variant="ghost" size="small" onClick={onClear}>
          Clear ghost
        </Button>
      </section>
    );
  }

  const deltas = raceDeltas(result, series);
  const verdict = deltas === null ? null : raceVerdict(deltas);
  if (deltas === null || verdict === null) {
    return (
      <section className="ghost-race" aria-labelledby="ghost-race-heading">
        <h2 id="ghost-race-heading">Ghost race</h2>
        <p className="hint" role="status">
          Racing {ghostName}, but these runs cannot compare turn by turn.
        </p>
        <Button variant="ghost" size="small" onClick={onClear}>
          Clear ghost
        </Button>
      </section>
    );
  }

  const current = deltas.find((point) => point.turn === activeTurn) ?? deltas[0];
  const ahead =
    verdict.impactDelta > 0 && verdict.efficiencyDelta > 0
      ? "Ahead on both boards."
      : verdict.impactDelta < 0 && verdict.efficiencyDelta < 0
        ? "Behind on both boards."
        : "Split decision — one board each way.";

  return (
    <section className="ghost-race" aria-labelledby="ghost-race-heading">
      <h2 id="ghost-race-heading">Ghost race</h2>
      <p className="hint">
        Racing {ghostName} · live minus ghost, replay follows the shared clock.
      </p>
      <table>
        <thead>
          <tr>
            <th scope="col">Board</th>
            <th scope="col" className="num">
              Turn {current?.turn ?? activeTurn}
            </th>
            <th scope="col" className="num">
              Final
            </th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <th scope="row">Impact</th>
            <td className="num">{formatDelta(current?.impactDelta ?? 0)}</td>
            <td className="num">{formatDelta(verdict.impactDelta)}</td>
          </tr>
          <tr>
            <th scope="row">Efficiency</th>
            <td className="num">{formatDelta(current?.efficiencyDelta ?? 0)}</td>
            <td className="num">{formatDelta(verdict.efficiencyDelta)}</td>
          </tr>
        </tbody>
      </table>
      <p className="hint" role="status">
        {ahead}
      </p>
      <Button variant="ghost" size="small" onClick={onClear}>
        Clear ghost
      </Button>
    </section>
  );
}
