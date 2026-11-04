"use client";

import {
  CHALLENGES,
  challengePassed,
  endlessVariant,
  evaluateChallenge,
  goalSummary,
  isChallengeUnlocked,
  nextEndlessCycle,
  parseEndlessId,
} from "@/lib/challenges";
import { Button } from "@/components/base/buttons/button";
import type { useMatch } from "./use-match";

type Match = ReturnType<typeof useMatch>;

/**
 * Casual challenge flow for the Simulation view: the city trials of
 * the unified simulation one at a time on the shared match engine (packing
 * shifts play in the console). Pick any unlocked city trial (chips),
 * run with the prompt written in Controls, see the verdict, then go
 * to the next — cleared trials keep their best impact, so any of
 * them can be revisited to rank higher.
 */
export default function ProgressStrip({
  match,
  canPlay,
  signedIn,
  onEditPrompt,
}: Readonly<{
  match: Match;
  canPlay: boolean;
  signedIn: boolean;
  onEditPrompt: () => void;
}>): React.ReactElement {
  const { completions, activeChallenge } = match;
  const clearedIds = Object.keys(completions);
  const activeIndex =
    activeChallenge === undefined
      ? -1
      : CHALLENGES.findIndex((entry) => entry.id === activeChallenge.id);
  const result = match.result;
  const showRecap = activeChallenge !== undefined && result !== null;
  const recapChecks = showRecap ? evaluateChallenge(activeChallenge, result) : [];
  const recapPassed = showRecap && challengePassed(recapChecks);
  const nextUp =
    activeIndex >= 0 && activeIndex + 1 < CHALLENGES.length
      ? CHALLENGES[activeIndex + 1]
      : undefined;
  const nextReady = nextUp !== undefined && isChallengeUnlocked(nextUp.id, clearedIds);
  const best =
    activeChallenge === undefined ? undefined : completions[activeChallenge.id];
  // Endless replays open per trial, not past the whole chain: any
  // cleared chain trial offers its next cycle (bars rising) on a
  // fresh city. Rotation trials sit outside the chain — no cycles.
  const activeEndless =
    activeChallenge === undefined ? null : parseEndlessId(activeChallenge.id);
  const activeBaseId = activeEndless?.baseId ?? activeChallenge?.id;
  const activeBase = CHALLENGES.find((entry) => entry.id === activeBaseId);
  const baseCleared =
    activeBase !== undefined && completions[activeBase.id] !== undefined;
  const endlessCycle =
    activeBase === undefined ? 1 : nextEndlessCycle(activeBase.id, completions);

  return (
    <section className="progress-strip" aria-label="Challenge progress">
      <div className="strip-chips" role="group" aria-label="Challenges">
        {match.unlocked
          .filter((entry) => entry.kind === "city")
          .map((entry) => {
            const index = CHALLENGES.findIndex((item) => item.id === entry.id);
            const done = completions[entry.id] !== undefined;
            return (
              <button
                key={entry.id}
                type="button"
                className="ghost"
                aria-pressed={activeChallenge?.id === entry.id}
                title={entry.title}
                onClick={() => {
                  match.pickChallenge(entry.id);
                }}
              >
                {index + 1}
                {done ? " ✓" : ""}
              </button>
            );
          })}
      </div>

      {activeChallenge === undefined ? (
        <p className="strip-note">
          Pick a challenge above — the chain runs one at a time and keeps your best
          impact on each, so you can always come back to rank higher.
        </p>
      ) : (
        <>
          <p className="kicker">
            {activeEndless !== null
              ? `Endless cycle ${String(activeEndless.cycle)}`
              : activeIndex >= 0
                ? `Challenge ${String(activeIndex + 1)}`
                : "Rotation trial"}
          </p>
          <h3 className="strip-title">{activeChallenge.title}</h3>
          <p className="strip-note">{goalSummary(activeChallenge)}</p>
          <p className="strip-note">{activeChallenge.tip}</p>
          {best !== undefined && (
            <p className="strip-note">
              Best impact {best.impact.toFixed(2)} ({best.model}) — run again to beat
              it.
            </p>
          )}
        </>
      )}

      {showRecap ? (
        <p className={recapPassed ? "strip-note verdict-pass" : "strip-note"}>
          {recapPassed ? "Challenge cleared" : "Challenge missed"}
          {match.boardPosition !== null
            ? ` — live board #${String(match.boardPosition)}`
            : ""}
          {": Impact "}
          {(result.scores.impact ?? 0).toFixed(2)}
          {", Efficiency "}
          {(result.scores.efficiency ?? 0).toFixed(2)}
        </p>
      ) : null}

      <form
        className="strip-actions"
        onSubmit={(event) => {
          event.preventDefault();
          void match.runMatch();
        }}
      >
        <Button type="submit" variant="primary" disabled={!canPlay || match.running}>
          {match.running ? "Running…" : "Run challenge"}
        </Button>
        <Button variant="ghost" size="small" onClick={onEditPrompt}>
          Edit prompt
        </Button>
        {nextReady && recapPassed ? (
          <Button
            variant="secondary"
            size="small"
            onClick={() => {
              match.pickChallenge(nextUp.id);
            }}
          >
            Next challenge
          </Button>
        ) : null}
      </form>
      {activeBase !== undefined && baseCleared ? (
        <p className="strip-actions">
          <Button
            variant="primary"
            size="small"
            onClick={() => {
              match.pickChallenge(endlessVariant(activeBase, endlessCycle).id);
            }}
          >
            Endless replay — cycle {endlessCycle} on a fresh city
          </Button>
        </p>
      ) : null}
      {!signedIn ? (
        <p className="strip-note">Sign in (top right) to run challenges.</p>
      ) : !canPlay ? (
        <p className="strip-note">Writing your prompt in Controls unlocks the run.</p>
      ) : null}
    </section>
  );
}
