"use client";

import { goalSummary, type Challenge } from "@/lib/challenges";
import { link } from "@/lib/routing";

interface TaskCardProps {
  challenge: Challenge | undefined;
  words: number;
  tokenBudget: number;
  seedText: string;
  /** Show the story beats inline. Off where a beat player already
   * runs beside the card. */
  showStory?: boolean;
}

/** The task before the prompt: what this run plays, and its limits. */
export default function TaskCard({
  challenge,
  words,
  tokenBudget,
  seedText,
  showStory = false,
}: TaskCardProps): React.ReactElement {
  // No open play: an absent challenge only means unlocks haven't
  // arrived yet, so the card waits instead of inventing a prompt.
  if (challenge === undefined) {
    return (
      <div className="challenge-card">
        <h3>Loading your trial…</h3>
        <p>
          Seed {seedText === "" ? "…" : seedText} · ≤ {String(words)} words · ≤{" "}
          {tokenBudget.toLocaleString("en-US")} tokens
        </p>
      </div>
    );
  }
  const goals = goalSummary(challenge)
    .split(" · ")
    .filter((part) => !part.startsWith("Seed "));
  const chips = [
    `Seed ${String(challenge.seed)}`,
    `≤ ${String(words)} words`,
    `≤ ${tokenBudget.toLocaleString("en-US")} tokens`,
    ...goals,
  ];
  return (
    <div className="challenge-card">
      <h3>{challenge.title}</h3>
      <p>{challenge.brief}</p>
      <p className="challenge-chips" aria-label="Task limits and targets">
        {chips.map((part) => (
          <span key={part} className="chip">
            {part}
          </span>
        ))}
      </p>
      <p className="hint">{challenge.tip}</p>
      {showStory && (
        <ol className="story-beats" aria-label="Trial story">
          {challenge.story.map((beat) => (
            <li key={beat}>{beat}</li>
          ))}
        </ol>
      )}
      <p className="hint">
        Full playbook per challenge: <a href={link("docs")}>app docs</a>.
      </p>
    </div>
  );
}
