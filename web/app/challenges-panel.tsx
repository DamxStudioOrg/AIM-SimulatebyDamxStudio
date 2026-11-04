"use client";

import { Button } from "@/components/base/buttons/button";
import { UNIFIED_CHAIN, nextUnifiedPlay, summarizeProgress } from "@/lib/challenges";
import type { Completion } from "@/lib/challenges";
import type { FocusPick } from "@/lib/focus";

const ROW_H = 22;
const LABEL_W = 118;
const BAR_MAX = 150;
const GRAPH_W = 312;
const GRAPH_PAD = 8;

/**
 * Console progress glance: cleared trials as labeled impact bars
 * (city yellow, tote green), bests chips, and the next trial with
 * a play CTA. No fixed total anywhere — the chain is endless, so
 * the panel counts clears, never denominators.
 */
export default function ChallengesPanel({
  completions,
  focus,
  onPlay,
}: Readonly<{
  completions: Record<string, Completion>;
  focus?: FocusPick | null;
  onPlay: (id: string) => void;
}>): React.ReactElement {
  const summary = summarizeProgress(completions);
  const cleared = UNIFIED_CHAIN.filter((entry) => completions[entry.id] !== undefined);
  const next = nextUnifiedPlay(completions);
  const height = cleared.length * ROW_H + GRAPH_PAD * 2;

  return (
    <section
      className="challenges-panel"
      aria-labelledby="challenges-heading"
      data-highlight
    >
      <h2 id="challenges-heading" data-highlight-title>
        Your challenges
      </h2>
      <p className="hint">
        {summary.cleared} {summary.cleared === 1 ? "trial" : "trials"} cleared
        {summary.endless > 0
          ? ` · ${String(summary.endless)} endless ${summary.endless === 1 ? "cycle" : "cycles"}`
          : ""}
        {summary.tote > 0
          ? ` · ${String(summary.tote)} ${summary.tote === 1 ? "tote" : "totes"} packed`
          : ""}
      </p>
      <ul className="cp-chips" aria-label="Bests">
        <li>
          Best impact{" "}
          {summary.bestImpact === null ? "—" : summary.bestImpact.toFixed(2)}
        </li>
        <li>
          Best efficiency{" "}
          {summary.bestEfficiency === null ? "—" : summary.bestEfficiency.toFixed(2)}
        </li>
      </ul>
      {cleared.length === 0 ? (
        <p className="empty">
          No cleared trials yet — clear your first to start the board.
        </p>
      ) : (
        <svg
          className="cp-graph"
          role="img"
          aria-label="Best impact per cleared trial"
          viewBox={`0 0 ${String(GRAPH_W)} ${String(height)}`}
        >
          {cleared.map((entry, index) => {
            const done = completions[entry.id];
            if (done === undefined) {
              return null;
            }
            const y = GRAPH_PAD + index * ROW_H;
            const width = Math.max(
              2,
              (Math.min(100, Math.max(0, done.impact)) / 100) * BAR_MAX,
            );
            const label =
              entry.title.length > 18 ? `${entry.title.slice(0, 17)}…` : entry.title;
            return (
              <g key={entry.id}>
                <title>{`${entry.title}: ${done.impact.toFixed(2)}`}</title>
                <text className="cp-label" x={0} y={y + 14}>
                  {label}
                </text>
                <rect
                  className={entry.kind === "tote" ? "cp-bar-tote" : "cp-bar-city"}
                  x={LABEL_W}
                  y={y + 3}
                  width={width}
                  height={12}
                  rx={3}
                />
                <text className="cp-value" x={LABEL_W + width + 6} y={y + 14}>
                  {done.impact.toFixed(1)}
                </text>
              </g>
            );
          })}
        </svg>
      )}
      {focus != null && (
        <div className="focus-card">
          <h3>Your focus — {focus.title}</h3>
          <p>{focus.reason}</p>
          <p className="cta-row">
            <Button
              variant="secondary"
              onClick={() => {
                onPlay(focus.drillId);
              }}
            >
              Play the drill — {focus.title}
            </Button>
          </p>
        </div>
      )}
      {next !== undefined && (
        <p className="cta-row">
          <Button
            variant="primary"
            onClick={() => {
              onPlay(next.id);
            }}
          >
            Play next — {next.title}
          </Button>
        </p>
      )}
    </section>
  );
}
