/**
 * Turn Brief – human-readable explanation of the current turn task.
 * Translates the recorded turn (shock schedule, skip state, spend)
 * into plain language so users understand what the model faced.
 */

import type { MatchTurn } from "@/lib/sim";
import { formatTokensWithThinking } from "@/lib/pricing";

interface TurnBriefProps {
  turnNo: number;
  turn?: MatchTurn;
}

const PHASE_TIPS: Record<string, string> = {
  Stewardship:
    "Build reserves and balanced housing/transit/health. Keep green > 10 for stewardship bias.",
  "Shock 1": "Expect crisis at turn 5. Pre-position rescue/shelter before impact.",
  Response: "Recover from Shock 1, repair damage, stabilize reserves.",
  "Shock 2":
    "Second shock hits. Prioritize rescue and shelter, accept temporary housing dip.",
  Recovery:
    "Maximize impact per token. Shift to housing/green for long-term efficiency.",
};

function phaseFor(turnNo: number): string {
  if (turnNo <= 4) return "Stewardship";
  if (turnNo === 5) return "Shock 1";
  if (turnNo <= 8) return "Response";
  if (turnNo === 9) return "Shock 2";
  return "Recovery";
}

export default function TurnBrief({
  turnNo,
  turn,
}: TurnBriefProps): React.ReactElement {
  if (turn === undefined) {
    return <div className="turn-brief hint">Loading turn brief…</div>;
  }

  const phase = phaseFor(turnNo);
  const crisisText =
    turn.skip_reason !== null
      ? `Turn skipped (${turn.skip_reason}) — the city ran on fumes`
      : turnNo === 5
        ? "Flood shock lands this turn"
        : turnNo === 9
          ? "Heat shock lands this turn"
          : "No shock scheduled this turn";

  return (
    <section className="turn-brief" aria-label="Turn brief">
      <h3>
        Turn {turnNo} – {phase}
      </h3>
      <p>
        <strong>Crisis:</strong> {crisisText}
      </p>
      <p>
        <strong>Spend:</strong> {turn.spend.toLocaleString()} · <strong>Tokens:</strong>{" "}
        {formatTokensWithThinking(turn.tokens_used, turn.thinking_tokens)}
        {turn.impact !== undefined && (
          <>
            {" "}
            · <strong>Impact:</strong> {turn.impact.toFixed(2)}
          </>
        )}
      </p>
      <p className="hint">
        <strong>Phase tip:</strong> {PHASE_TIPS[phase]}
      </p>
      <h4>What to decide now</h4>
      <ul>
        <li>
          Allocate 100 points across 8 budget keys: housing, transit, health, green,
          reserves, rescue, shelter, repair.
        </li>
        <li>Pick 0-2 policies from the allowlist.</li>
        <li>Consider forecast risk and remaining token budget.</li>
      </ul>
      <h4>Prompting guidance</h4>
      <ul>
        <li>
          Be explicit about turn ranges: “turns 1-4 build reserves, turn 5 shift to
          rescue”.
        </li>
        <li>Reference shocks by name and turn.</li>
        <li>Use concise trade-offs, not generic advice.</li>
      </ul>
    </section>
  );
}
