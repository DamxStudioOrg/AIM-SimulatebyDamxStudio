"use client";

import { Button } from "@/components/base/buttons/button";
import {
  UNIFIED_CHAIN,
  challengeById,
  clearedChallengeIds,
  endlessVariant,
  isUnifiedUnlocked,
  nextEndlessCycle,
  parseEndlessId,
  type Challenge,
  type Completion,
  type GoalCheck,
} from "@/lib/challenges";
import { buildCoaching } from "@/lib/coaching";
import { formatTokensWithThinking } from "@/lib/pricing";
import type { JudgeVerdict } from "@/lib/prompt-judge";
import PromptCraft from "./prompt-craft";
import type { MatchResultPayload } from "@/lib/sim";
import { bestVariantIndex } from "@/lib/variants";
import type { VariantRun } from "@/lib/variants";

export interface ChallengeAftermathProps {
  challenge: Challenge;
  result: MatchResultPayload;
  checks: GoalCheck[];
  cleared: boolean;
  /** Best recorded completion for this trial, if any yet. */
  best: Completion | undefined;
  completions: Record<string, Completion>;
  onRetryPrompt: () => void;
  onRetryModel: () => void;
  onGoTo: (id: string) => void;
  /** Finished variety runs; the strip compares them, best run counts. */
  variants?: VariantRun[] | null;
  /** Live-board slot for this run; null until the post lands. */
  boardPosition: number | null;
  /** Full-analysis dashboard visibility (the dashboard itself plays
   * in the left visual panel via the route's scroll spy). */
  showFull: boolean;
  onToggleFull: () => void;
  /** The steward draft behind this verdict, craft-checked live. */
  prompt?: string;
  /** Tier-4 judge (opt-in): one rubric call on the player's model. */
  onJudge?: () => void;
  judging?: boolean;
  judgeVerdict?: JudgeVerdict | null;
  /** "model · N tokens" provenance line for the verdict. */
  judgeMeta?: string | null;
  judgeError?: string | null;
}

function formatDelta(current: number, best: number): string {
  const delta = current - best;
  const sign = delta >= 0 ? "+" : "";
  return `${sign}${delta.toFixed(2)}`;
}

/**
 * Post-trial aftermath: the challenge's story beat lands the run,
 * then the steward chooses — retry with a new prompt, retry with
 * another model, or move on. A compact side analysis travels with
 * the verdict; the full dashboard opens on request. Cleared trials
 * (and endless replays) offer the next step; missed trials must be
 * cleared before the chain continues. Variety runs add a compare
 * strip: the same prompt over three worlds, best run counts.
 */
export default function ChallengeAftermath({
  challenge,
  result,
  checks,
  cleared,
  best,
  completions,
  onRetryPrompt,
  onRetryModel,
  onGoTo,
  variants,
  boardPosition,
  showFull,
  onToggleFull,
  prompt,
  onJudge,
  judging = false,
  judgeVerdict = null,
  judgeMeta = null,
  judgeError = null,
}: ChallengeAftermathProps): React.ReactElement {
  const clearedIds = clearedChallengeIds(completions);
  const endless = parseEndlessId(challenge.id);
  const baseId = endless?.baseId ?? challenge.id;
  const base = challengeById(baseId) ?? challenge;

  const chainIndex = UNIFIED_CHAIN.findIndex((entry) => entry.id === baseId);
  const chainNext =
    endless === null && chainIndex >= 0 ? UNIFIED_CHAIN[chainIndex + 1] : undefined;
  // The recording effect may not have run yet on first render, so a
  // just-cleared trial already unlocks what follows.
  const nextReady =
    chainNext !== undefined && (cleared || isUnifiedUnlocked(chainNext.id, clearedIds));
  const cycle = nextEndlessCycle(baseId, completions);
  const endlessId = endlessVariant(base, cycle).id;

  const strip = variants ?? [];
  const bestAt =
    strip.length > 1 ? bestVariantIndex(strip.map((entry) => entry.result)) : -1;
  const impact = result.scores.impact ?? 0;
  const efficiency = result.scores.efficiency ?? 0;
  const tokens = result.totals.tokens_used ?? 0;
  const thinking = result.totals.thinking_tokens ?? 0;
  const spend = result.totals.spend ?? 0;
  const closingBeat = challenge.story[challenge.story.length - 1] ?? "";
  const coaching = buildCoaching(result);

  return (
    <div
      className={cleared ? "verdict verdict-pass aftermath" : "verdict aftermath"}
      data-visual="aftermath"
    >
      <p className="kicker">The Steward&apos;s Cycle — aftermath</p>
      <h3>
        {cleared ? `${challenge.title} holds` : `${challenge.title} stands`} —{" "}
        {cleared ? "trial cleared" : "trial missed"}
      </h3>
      {closingBeat !== "" && <p className="lede">{closingBeat}</p>}
      <div className="aftermath-grid">
        <div className="aftermath-main">
          <ul className="tight">
            {checks.map((check) => (
              <li key={check.label} className={check.passed ? "pass" : "miss"}>
                {check.passed ? "✓" : "✗"} {check.label} — now {check.actual}
              </li>
            ))}
          </ul>
          {best !== undefined && (
            <p className="hint">
              Best: impact {best.impact.toFixed(2)} on {best.when} ({best.model}).
            </p>
          )}
          {boardPosition !== null && (
            <p className="hint">
              Posted #{boardPosition} — <a href="/ranks">view board</a>
            </p>
          )}
          <div className="coaching">
            <p className="kicker">Do differently next time</p>
            {coaching.tips.length > 0 ? (
              <ul className="tight">
                {coaching.tips.map((tip) => (
                  <li key={tip}>{tip}</li>
                ))}
              </ul>
            ) : (
              <p className="hint">
                Clean run — no drops, skips, or idle turns. Take the chain.
              </p>
            )}
            {prompt !== undefined && (
              <PromptCraft prompt={prompt} challenge={challenge} compact />
            )}
            {onJudge !== undefined && judgeVerdict === null && (
              <p className="prompt-actions">
                <Button
                  variant="secondary"
                  size="small"
                  disabled={judging}
                  onClick={onJudge}
                >
                  {judging ? "Judging…" : "Judge this prompt"}
                </Button>{" "}
                <span className="hint">one rubric call on your model</span>
              </p>
            )}
            {judgeError !== null && (
              <p className="error" role="alert">
                {judgeError}
              </p>
            )}
            {judgeVerdict !== null && (
              <div className="judge-verdict">
                <p className="kicker">
                  Model judge{judgeMeta === null ? "" : ` · ${judgeMeta}`}
                </p>
                <ul className="judge-scores">
                  {(
                    [
                      ["Clarity", judgeVerdict.scores.clarity],
                      ["Specificity", judgeVerdict.scores.specificity],
                      ["Contingency", judgeVerdict.scores.contingency],
                      ["Economy", judgeVerdict.scores.economy],
                    ] as const
                  ).map(([label, score]) => (
                    <li key={label}>
                      <span className="judge-label">{label}</span>
                      <span className="judge-bar" aria-hidden="true">
                        <span style={{ width: `${String(score * 10)}%` }} />
                      </span>
                      <span className="judge-value">{score}/10</span>
                    </li>
                  ))}
                </ul>
                {judgeVerdict.advice.length > 0 && (
                  <ul className="tight">
                    {judgeVerdict.advice.map((line) => (
                      <li key={line}>{line}</li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>
          {bestAt >= 0 && (
            <div className="variant-strip">
              <p className="kicker">Same prompt, three worlds — best run counts</p>
              <ul className="tight">
                {strip.map((entry, index) => (
                  <li
                    key={entry.label}
                    className={index === bestAt ? "pass" : undefined}
                  >
                    {index === bestAt ? "★ " : ""}
                    {entry.label} — impact{" "}
                    {(entry.result.scores.impact ?? 0).toFixed(2)}
                    {", efficiency "}
                    {(entry.result.scores.efficiency ?? 0).toFixed(2)}
                    {index === bestAt ? " — best run" : ""}
                  </li>
                ))}
              </ul>
            </div>
          )}
          <p className="cta-row aftermath-actions">
            <Button variant="primary" onClick={onRetryPrompt}>
              Retry with a new prompt
            </Button>{" "}
            <Button variant="secondary" onClick={onRetryModel}>
              Retry with another model
            </Button>{" "}
            {endless !== null ? (
              <Button
                variant="ghost"
                onClick={() => {
                  onGoTo(endlessId);
                }}
              >
                Next cycle — {base.title} {cycle}
              </Button>
            ) : (
              <>
                {chainNext !== undefined && (
                  <Button
                    variant="ghost"
                    disabled={!nextReady}
                    title={
                      nextReady ? undefined : "Clear this trial to unlock the next"
                    }
                    onClick={() => {
                      onGoTo(chainNext.id);
                    }}
                  >
                    Next challenge — {chainNext.title}
                  </Button>
                )}{" "}
                {cleared && (
                  <Button
                    variant="ghost"
                    onClick={() => {
                      onGoTo(endlessId);
                    }}
                  >
                    Endless replay — cycle {cycle}
                  </Button>
                )}
              </>
            )}
          </p>
          {!cleared && (
            <p className="hint">
              Clear this trial to unlock what follows — the chain only opens forward.
            </p>
          )}
        </div>
        <aside className="aftermath-side" aria-label="Run analysis">
          <dl className="aftermath-stats">
            <div>
              <dt>Impact</dt>
              <dd>
                {impact.toFixed(2)}
                {best !== undefined && (
                  <span className="delta"> ({formatDelta(impact, best.impact)})</span>
                )}
              </dd>
            </div>
            <div>
              <dt>Efficiency</dt>
              <dd>{efficiency.toFixed(2)}</dd>
            </div>
            <div>
              <dt>Tokens</dt>
              <dd>{formatTokensWithThinking(tokens, thinking)}</dd>
            </div>
            <div>
              <dt>Spend</dt>
              <dd>${spend.toLocaleString("en-US")}</dd>
            </div>
          </dl>
          <p className="cta-row">
            <Button
              variant="ghost"
              size="small"
              aria-expanded={showFull}
              onClick={onToggleFull}
            >
              {showFull ? "Hide full data analysis" : "Show full data analysis"}
            </Button>
          </p>
        </aside>
      </div>
    </div>
  );
}
