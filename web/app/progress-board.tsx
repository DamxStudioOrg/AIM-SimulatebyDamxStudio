"use client";

import {
  UNIFIED_CHAIN,
  nextEndlessCycle,
  nextUnifiedPlay,
  summarizeProgress,
} from "@/lib/challenges";
import type { Completion } from "@/lib/challenges";

/**
 * Personal progress as a cleared-trials board: only finished
 * challenges render, in unified chain order (city and tote
 * alternating), each with its kind, best score, and model — no
 * fixed numbering, no placeholder rows for the uncleared. A next-up
 * line points at the coming trial. Published to the left stage
 * slot on the ranks route; the arena stats tab reuses it.
 */
export default function ProgressBoard({
  completions,
  runCount,
}: Readonly<{
  completions: Record<string, Completion>;
  runCount: number;
}>): React.ReactElement {
  const summary = summarizeProgress(completions);
  const clearedCount = summary.cleared + summary.tote;
  const next = nextUnifiedPlay(completions);
  return (
    <section className="progress-board" aria-label="Your progress">
      <p className="kicker">Your progress</p>
      <h3 className="board-title">
        {summary.cleared} {summary.cleared === 1 ? "trial" : "trials"} cleared
        {summary.endless > 0
          ? ` · ${String(summary.endless)} endless ${summary.endless === 1 ? "cycle" : "cycles"}`
          : ""}
        {summary.tote > 0
          ? ` · ${String(summary.tote)} ${summary.tote === 1 ? "tote" : "totes"} packed`
          : ""}
      </h3>
      <p className="board-note">
        {runCount} recorded run{runCount === 1 ? "" : "s"} on this device.
        {summary.bestImpact !== null
          ? ` Best impact ${summary.bestImpact.toFixed(2)}.`
          : " Clear a challenge to post a best."}
        {summary.bestEfficiency !== null
          ? ` Best efficiency ${summary.bestEfficiency.toFixed(2)}.`
          : ""}
      </p>
      {clearedCount === 0 ? (
        <p className="board-empty">
          No cleared trials yet — your board fills in as you clear challenges.
        </p>
      ) : (
        <ul className="board-list">
          {UNIFIED_CHAIN.map((entry) => {
            const done = completions[entry.id];
            if (done === undefined) {
              return null;
            }
            const topCycle = nextEndlessCycle(entry.id, completions) - 1;
            const score =
              entry.kind === "tote"
                ? `Score ${done.impact.toFixed(1)}`
                : `Impact ${done.impact.toFixed(2)}`;
            return (
              <li key={entry.id}>
                <span className="board-kind" data-kind={entry.kind}>
                  {entry.kind}
                </span>
                <span className="board-name" title={entry.title}>
                  {entry.title}
                </span>
                <span className="board-meta" title={done.model}>
                  {score} · {done.model}
                  {topCycle > 0 ? ` · endless ${String(topCycle)}` : ""}
                </span>
              </li>
            );
          })}
        </ul>
      )}
      {next !== undefined && (
        <p className="board-next">
          Next up: <strong>{next.title}</strong>
        </p>
      )}
    </section>
  );
}
