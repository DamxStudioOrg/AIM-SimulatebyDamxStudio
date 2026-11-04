"use client";

import { ListNumbersIcon, MoonIcon, TrophyIcon } from "@phosphor-icons/react";
import { summarizeProgress } from "@/lib/challenges";
import type { Completion } from "@/lib/challenges";
import type { CenterView } from "./stage-view-tools";

/**
 * Dock moon at the Simulation view's top-left: the
 * Simulation/Ranks/Stats switch plus compact progress readouts
 * on a Controls-sized disc wearing the planet's dark
 * background.
 */
export default function MoonDock({
  view,
  onSelect,
  completions,
}: Readonly<{
  view: CenterView;
  onSelect: (next: CenterView) => void;
  completions: Record<string, Completion>;
}>): React.ReactElement {
  const summary = summarizeProgress(completions);
  return (
    <div className="moon-dock">
      <div className="dock-nav" role="group" aria-label="Center view">
        <button
          type="button"
          className="ghost"
          aria-pressed={view === "game"}
          onClick={() => {
            onSelect("game");
          }}
        >
          <MoonIcon size={16} aria-hidden="true" /> Simulation
        </button>
        <button
          type="button"
          className="ghost"
          aria-pressed={view === "ranks"}
          onClick={() => {
            onSelect("ranks");
          }}
        >
          <TrophyIcon size={16} aria-hidden="true" /> Ranks
        </button>
        <button
          type="button"
          className="ghost"
          aria-pressed={view === "stats"}
          onClick={() => {
            onSelect("stats");
          }}
        >
          <ListNumbersIcon size={16} aria-hidden="true" /> Stats
        </button>
      </div>
      <p className="dock-readout">
        {summary.cleared}/{summary.total} cleared
        {summary.bestImpact !== null ? ` · best ${summary.bestImpact.toFixed(1)}` : ""}
      </p>
    </div>
  );
}
