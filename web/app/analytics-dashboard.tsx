/**
 * Enhanced analytics dashboard for model comparison and prompting practice.
 * Designed for researchers, scientists and casual community play.
 */

import type { MatchResultPayload } from "@/lib/sim";
import { downloadCsv, exportDeltaCsv, exportTurnCsv } from "@/lib/csv-export";
import { turnImpactSeries, turnTokenSeries } from "@/lib/run-charts";
import { craftScatterPoints } from "@/lib/prompt-analysis";
import type { CraftPoint } from "@/lib/prompt-analysis";
import { buildTips } from "@/lib/prompt-tips";
import { formatTokensWithThinking } from "@/lib/pricing";
import { StatCards } from "@/components/application/dashboard/stat-cards";
import { RevenueChartCard } from "@/components/application/dashboard/revenue-chart-card";
import { OrdersChartCard } from "@/components/application/dashboard/orders-chart-card";
import { Button } from "@/components/base/buttons/button";
import {
  RiBarChartBoxLine,
  RiFlashlightLine,
  RiSeedlingLine,
  RiTimerLine,
} from "@remixicon/react";

interface AnalyticsDashboardProps {
  results?: MatchResultPayload[];
  activeId?: string;
  /** Turns the coaching rules flagged; the table tints their rows. */
  flagTurns?: readonly number[];
  /** Recorded runs with saved prompts; feeds the craft scatter. */
  craftEntries?: readonly { prompt: string; impact: number }[];
}

function runId(result: MatchResultPayload): string {
  return `${result.provider}-seed${String(result.seed)}`;
}

/**
 * Prompt craft vs impact, one dot per recorded run: does structure
 * pay on this device? The dashed line is the craft bar (60) the
 * History correlation quotes.
 */
function CraftScatter({
  points,
}: Readonly<{ points: readonly CraftPoint[] }>): React.ReactElement {
  const width = 300;
  const height = 190;
  const left = 30;
  const right = 292;
  const top = 10;
  const bottom = 158;
  const maxImpact = Math.max(
    100,
    ...points.map((point) => Math.ceil(point.impact / 10) * 10),
  );
  const x = (craft: number): number => left + (craft / 100) * (right - left);
  const y = (impact: number): number => bottom - (impact / maxImpact) * (bottom - top);
  return (
    <figure className="craft-scatter">
      <svg
        viewBox={`0 0 ${String(width)} ${String(height)}`}
        role="img"
        aria-label="Scatter of prompt craft score against run impact"
      >
        {[0, 50, 100].map((tick) => (
          <g key={tick}>
            <line
              x1={left}
              x2={right}
              y1={y(tick)}
              y2={y(tick)}
              stroke="var(--line)"
              strokeWidth="1"
            />
            <text x={4} y={y(tick) + 3} fontSize="8" fill="var(--muted)">
              {tick}
            </text>
          </g>
        ))}
        <line
          x1={x(60)}
          x2={x(60)}
          y1={top}
          y2={bottom}
          stroke="var(--gold)"
          strokeWidth="1"
          strokeDasharray="4 3"
        />
        {points.map((point, index) => (
          <circle
            key={index}
            cx={x(point.craft)}
            cy={y(Math.min(point.impact, maxImpact))}
            r="3"
            fill={point.craft >= 60 ? "var(--brand-2)" : "var(--muted)"}
            opacity="0.85"
          />
        ))}
        <text x={x(60) + 4} y={top + 8} fontSize="8" fill="var(--gold)">
          craft 60
        </text>
        <text x={left} y={height - 14} fontSize="8" fill="var(--muted)">
          prompt craft →
        </text>
        <text x={right - 30} y={height - 14} fontSize="8" fill="var(--muted)">
          impact ↑
        </text>
      </svg>
      <figcaption className="hint">
        Prompt craft vs impact — {points.length} recorded runs. Right of the line is
        structured; the History line quotes the two averages.
      </figcaption>
    </figure>
  );
}

export default function AnalyticsDashboard({
  results = [],
  activeId,
  flagTurns = [],
  craftEntries = [],
}: AnalyticsDashboardProps): React.ReactElement {
  if (results.length === 0) {
    return (
      <div className="analytics-dashboard hint">
        Run matches to compare models and prompts.
      </div>
    );
  }

  const active = results.find((r) => runId(r) === activeId) ?? results[0];
  const compare = results.find((r) => r !== active);
  if (active === undefined) {
    return <div className="analytics-dashboard hint">Run matches first.</div>;
  }

  const modelRows = results.map((r) => ({
    id: runId(r),
    provider: r.provider,
    impact: r.scores.impact ?? 0,
    efficiency: r.scores.efficiency ?? 0,
    tokens: r.totals.tokens_used ?? 0,
    badges: r.badges.length,
  }));

  const bestImpact = [...modelRows].sort((a, b) => b.impact - a.impact)[0];
  const bestEff = [...modelRows].sort((a, b) => b.efficiency - a.efficiency)[0];
  const avgTokens = modelRows.reduce((s, r) => s + r.tokens, 0) / modelRows.length;
  const avgImpact = modelRows.reduce((s, r) => s + r.impact, 0) / modelRows.length;
  const impacts = modelRows.map((r) => r.impact);
  const impactSpread = Math.max(...impacts) - Math.min(...impacts);
  const activeIdValue = runId(active);
  const craftPoints = craftScatterPoints(craftEntries);

  return (
    <section className="analytics-dashboard dark">
      <div className="dashboard-header">
        <h3>Model comparison</h3>
        <div className="actions">
          <Button
            variant="secondary"
            size="small"
            onClick={() => {
              downloadCsv(
                exportTurnCsv(active, activeIdValue),
                `simulate-${activeIdValue}.csv`,
              );
            }}
          >
            Export CSV
          </Button>
          <Button
            variant="secondary"
            size="small"
            onClick={() => {
              const all = results.map((r) => exportTurnCsv(r, runId(r))).join("\n");
              downloadCsv(all, "simulate-comparison.csv");
            }}
          >
            Export all CSV
          </Button>
          {compare !== undefined && (
            <Button
              variant="secondary"
              size="small"
              onClick={() => {
                downloadCsv(
                  exportDeltaCsv(active, compare, activeIdValue, runId(compare)),
                  `simulate-delta-${activeIdValue}-${runId(compare)}.csv`,
                );
              }}
            >
              Export delta CSV
            </Button>
          )}
        </div>
      </div>
      <p className="quick-summary">
        Quick summary: {modelRows.length} runs compared. Best impact{" "}
        {bestImpact?.impact.toFixed(2) ?? "-"} by {bestImpact?.provider ?? "-"}, best
        efficiency {bestEff?.efficiency.toFixed(2) ?? "-"} by {bestEff?.provider ?? "-"}
        . Avg impact {avgImpact.toFixed(2)} across {avgTokens.toFixed(0)} tokens per
        run. Impact spread {impactSpread.toFixed(2)}.
      </p>
      <StatCards
        variant="plain"
        columns={2}
        stats={[
          {
            icon: RiBarChartBoxLine,
            label: "Best impact",
            value: bestImpact?.impact.toFixed(2) ?? "-",
            delta: bestImpact?.provider ?? "-",
            deltaColor: "lime" as const,
          },
          {
            icon: RiFlashlightLine,
            label: "Best efficiency",
            value: bestEff?.efficiency.toFixed(2) ?? "-",
            delta: bestEff?.provider ?? "-",
            deltaColor: "lime" as const,
          },
          {
            icon: RiSeedlingLine,
            label: "Avg impact",
            value: avgImpact.toFixed(2),
            delta: `${avgTokens.toFixed(0)} tokens`,
            deltaColor: "neutral" as const,
          },
          {
            icon: RiTimerLine,
            label: "Impact spread",
            value: impactSpread.toFixed(2),
            delta: `${String(modelRows.length)} runs`,
            deltaColor: "rose" as const,
          },
        ]}
      />
      <p className="hint">
        Tip: keep impact spread low across seeds for robust prompts; high spread signals
        seed sensitivity.
      </p>
      <div className="chart-row">
        <div className="chart-cell">
          <RevenueChartCard
            className="boardui-card"
            data={turnImpactSeries(active.turns, compare?.turns)}
            title="Impact per turn"
            currentLabel={activeIdValue}
            previousLabel={compare === undefined ? "No second run" : runId(compare)}
            totalCaption="compare total"
            pointCaption="compare turn"
            formatValue={(value: number): string => value.toFixed(2)}
            formatAxis={(value: number): string => value.toFixed(1)}
            decimals={2}
          />
        </div>
        <div className="chart-cell">
          <OrdersChartCard
            className="boardui-card"
            data={turnTokenSeries(active.turns, compare?.turns)}
            title="Tokens per turn"
            currentLabel={activeIdValue}
            previousLabel={compare === undefined ? "No second run" : runId(compare)}
            totalCaption="compare total"
            pointCaption="compare turn"
          />
        </div>
      </div>
      {craftPoints.length >= 3 && <CraftScatter points={craftPoints} />}
      <div className="table-scroll">
        <table className="compare-table">
          <thead>
            <tr>
              <th>Provider</th>
              <th>Impact</th>
              <th>Efficiency</th>
              <th>Tokens</th>
              <th>Badges</th>
            </tr>
          </thead>
          <tbody>
            {modelRows.map((r) => (
              <tr key={r.id} className={r.id === activeIdValue ? "active" : ""}>
                <td>{r.provider}</td>
                <td>{r.impact.toFixed(2)}</td>
                <td>{r.efficiency.toFixed(2)}</td>
                <td>{r.tokens}</td>
                <td>{r.badges}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h4>Prompt practice tips</h4>
      <ul>
        {buildTips(active, { impactSpread }).map((tip) => (
          <li key={tip}>{tip}</li>
        ))}
      </ul>

      <h4>Per-turn metrics</h4>
      <table className="per-turn-table">
        <thead>
          <tr>
            <th>Turn</th>
            <th>Impact</th>
            <th>Efficiency</th>
            <th>Tokens</th>
            <th>Spend</th>
            {compare !== undefined && <th>Δ Impact</th>}
          </tr>
        </thead>
        <tbody>
          {active.turns.map((t) => {
            const ct = compare?.turns.find((x) => x.turn === t.turn);
            const delta = ct !== undefined ? (t.impact ?? 0) - (ct.impact ?? 0) : null;
            const flagged = flagTurns.includes(t.turn);
            return (
              <tr
                key={t.turn}
                className={flagged ? "flag" : undefined}
                title={flagged ? "Coaching flagged this turn" : undefined}
              >
                <td>{t.turn}</td>
                <td>{(t.impact ?? 0).toFixed(2)}</td>
                <td>{(t.efficiency ?? 0).toFixed(2)}</td>
                <td>{formatTokensWithThinking(t.tokens_used, t.thinking_tokens)}</td>
                <td>{t.spend}</td>
                {compare !== undefined && (
                  <td>{delta === null ? "—" : delta.toFixed(2)}</td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}
