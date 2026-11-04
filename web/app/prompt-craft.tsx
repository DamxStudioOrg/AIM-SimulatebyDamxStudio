"use client";

import { useMemo } from "react";
import type { Challenge } from "@/lib/challenges";
import { analyzePrompt } from "@/lib/prompt-analysis";

/**
 * Prompt craft: the rubric over the steward draft, live in the
 * submit form and as a one-line echo beside the verdict. A
 * teaching scaffold — the score names the moves, the player's own
 * craft-vs-impact record in History says whether they pay off.
 */
export default function PromptCraft({
  prompt,
  challenge,
  compact = false,
}: Readonly<{
  prompt: string;
  challenge?: Challenge;
  compact?: boolean;
}>): React.ReactElement {
  const analysis = useMemo(() => analyzePrompt(prompt, challenge), [prompt, challenge]);
  if (compact) {
    const missing = analysis.items
      .filter((entry) => entry.state !== "have")
      .map((entry) => entry.label.toLowerCase());
    return (
      <p className="prompt-craft-line">
        Prompt craft <strong>{analysis.score}/100</strong>
        {missing.length > 0
          ? ` — missing: ${missing.join(" · ")}`
          : " — every move named"}
      </p>
    );
  }
  return (
    <div className="prompt-craft" aria-label="Prompt craft checklist">
      <p className="prompt-craft-head">
        <strong>Prompt craft</strong>
        <span className="hint">moves strong prompts make, checked live</span>
        <span className="prompt-craft-score">{analysis.score}/100</span>
      </p>
      <ul className="prompt-craft-list">
        {analysis.items.map((entry) => (
          <li key={entry.id} data-state={entry.state}>
            <span className="prompt-craft-mark" aria-hidden="true">
              {entry.state === "have" ? "✓" : entry.state === "partial" ? "~" : "—"}
            </span>
            <span>
              {entry.label}. <span className="prompt-craft-detail">{entry.detail}</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
