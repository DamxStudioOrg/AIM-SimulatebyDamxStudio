/**
 * Analytics panel for per-run and per-prompt metrics.
 * Shows impact per token, efficiency trend, shock response, token burn, and strategy fingerprint.
 */

import type { MatchResultPayload } from "@/lib/sim";
import { useEffect, useRef } from "react";
import { exportTurnCsv, downloadCsv } from "@/lib/csv-export";
import { formatTokensWithThinking } from "@/lib/pricing";
import { Button } from "@/components/base/buttons/button";

interface AnalyticsPanelProps {
  result?: MatchResultPayload | null;
}

export default function AnalyticsPanel({
  result,
}: AnalyticsPanelProps): React.ReactElement {
  const sparkRef = useRef<HTMLCanvasElement | null>(null);

  if (!result) {
    return (
      <section className="analytics-panel" aria-label="Analytics">
        <p className="hint">Run a match to see analytics.</p>
      </section>
    );
  }

  const turns = result.turns;
  const tokensUsed = result.totals.tokens_used ?? 0;
  const thinkingUsed = result.totals.thinking_tokens ?? 0;
  const impactPerToken = tokensUsed ? (result.scores.impact ?? 0) / tokensUsed : 0;

  const avgEfficiency = turns.length
    ? turns.reduce((a, t) => a + (t.efficiency ?? 0), 0) / turns.length
    : 0;

  const shockResponse = turns
    .filter((t) => (t.turn >= 5 && t.turn <= 7) || (t.turn >= 9 && t.turn <= 11))
    .map((t) => ({
      turn: t.turn,
      impact: t.impact ?? 0,
      efficiency: t.efficiency ?? 0,
    }));

  useEffect(() => {
    const canvas = sparkRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const w = (canvas.width = canvas.offsetWidth * 2);
    const h = (canvas.height = 60 * 2);
    ctx.clearRect(0, 0, w, h);
    const data = result.turns.map((t) => t.efficiency ?? 0);
    const max = Math.max(...data, 1);
    ctx.strokeStyle = "var(--brand-2)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    data.forEach((v, i) => {
      const x = (i / (data.length - 1)) * w;
      const y = h - (v / max) * h;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();
  }, [result]);

  return (
    <section className="analytics-panel" aria-label="Analytics">
      <h3>Run analytics</h3>
      <dl className="metrics">
        <div>
          <dt>Impact</dt>
          <dd>{(result.scores.impact ?? 0).toFixed(2)}</dd>
        </div>
        <div>
          <dt>Efficiency</dt>
          <dd>{(result.scores.efficiency ?? 0).toFixed(2)}</dd>
        </div>
        <div>
          <dt>Impact per token</dt>
          <dd>{impactPerToken.toFixed(4)}</dd>
        </div>
        <div>
          <dt>Avg efficiency</dt>
          <dd>{avgEfficiency.toFixed(2)}</dd>
        </div>
        <div>
          <dt>Tokens used</dt>
          <dd>{formatTokensWithThinking(tokensUsed, thinkingUsed)}</dd>
        </div>
        <div>
          <dt>Badges</dt>
          <dd>{result.badges.join(", ") || "—"}</dd>
        </div>
      </dl>

      <div className="panel-actions">
        <Button
          variant="secondary"
          size="small"
          onClick={() => {
            const runId = `${result.provider}-seed${String(result.seed)}`;
            const csv = exportTurnCsv(result, runId);
            downloadCsv(csv, `simulate-${runId}.csv`);
          }}
        >
          Export per-turn CSV
        </Button>
      </div>

      <h4>Efficiency trend</h4>
      <canvas ref={sparkRef} className="sparkline" aria-label="Efficiency trend" />

      <h4>Shock response</h4>
      <ul className="shock-list">
        {shockResponse.map((s) => (
          <li key={s.turn}>
            Turn {s.turn}: impact {s.impact.toFixed(1)} · efficiency{" "}
            {s.efficiency.toFixed(1)}
          </li>
        ))}
      </ul>

      <h4>Strategy fingerprint</h4>
      <pre className="fingerprint">{JSON.stringify(result.strategy, null, 2)}</pre>
    </section>
  );
}
