/**
 * Prompt version graph for visualizing prompt evolution.
 * BoardUI area card charts impact over versions for a given
 * seed/challenge; the list below keeps the per-version details.
 */

import type { HistoryEntry } from "@/lib/history";
import { versionImpactSeries } from "@/lib/run-charts";
import { RevenueChartCard } from "@/components/application/dashboard/revenue-chart-card";

export default function PromptVersionGraph({ entries }: { entries: HistoryEntry[] }) {
  const cityEntries = entries.filter((e) => e.result && "turns" in e.result);
  if (cityEntries.length === 0) return null;

  return (
    <div className="prompt-version-graph dark">
      <h4>Prompt versions</h4>
      <RevenueChartCard
        className="boardui-card"
        data={versionImpactSeries(cityEntries)}
        title="Impact by version"
        currentLabel="This version"
        previousLabel="Previous version"
        totalCaption="previous total"
        pointCaption="previous version"
        formatValue={(value: number): string => value.toFixed(1)}
        formatAxis={(value: number): string => value.toFixed(1)}
        decimals={1}
      />
      <ul>
        {cityEntries.map((e) => (
          <li key={e.when}>
            <span>{e.when.slice(0, 10)}</span>
            <span>Impact {(e.impact ?? 0).toFixed(1)}</span>
            <span>Eff {(e.efficiency ?? 0).toFixed(2)}</span>
            <span className="chip">{e.provider}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
