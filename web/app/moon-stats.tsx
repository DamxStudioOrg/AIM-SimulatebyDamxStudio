interface MoonStatsProps {
  matches: number;
  bestImpact: number | null;
  bestEfficiency: number | null;
  cleared: number;
}

/**
 * Record strip for the left visual panel: the steward's matches,
 * bests, and cleared trials, published by the console when signed
 * in. Compact by design — it shares the square with the moon and
 * the scroll-driven visual below it.
 */
export default function MoonStats({
  matches,
  bestImpact,
  bestEfficiency,
  cleared,
}: MoonStatsProps): React.ReactElement {
  return (
    <dl className="moon-stats" aria-label="Your record in this browser">
      <div>
        <dt>Matches</dt>
        <dd>{matches}</dd>
      </div>
      <div>
        <dt>Best impact</dt>
        <dd>{bestImpact === null ? "—" : bestImpact.toFixed(2)}</dd>
      </div>
      <div>
        <dt>Best efficiency</dt>
        <dd>{bestEfficiency === null ? "—" : bestEfficiency.toFixed(2)}</dd>
      </div>
      <div>
        <dt>Challenges cleared</dt>
        <dd>{cleared}</dd>
      </div>
    </dl>
  );
}
