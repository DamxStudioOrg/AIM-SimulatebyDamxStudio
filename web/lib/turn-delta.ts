/** One-line readout of what changed in a replay turn. */

import type { MatchTurn } from "./sim";
import { formatTokensWithThinking } from "./pricing";

function fmtSpend(value: number): string {
  return `$${String(Math.round(value / 1000))}k`;
}

function fmtSwing(current: number, previous: number): string {
  const delta = Math.round((current - previous) / 1000);
  if (delta === 0) {
    return "";
  }
  if (delta > 0) {
    return ` (+$${String(delta)}k)`;
  }
  return ` (-$${String(Math.abs(delta))}k)`;
}

function leadKey(allocation: Record<string, number> | null): string {
  if (allocation === null) {
    return "no allocation";
  }
  let best = "";
  let bestValue = Number.NEGATIVE_INFINITY;
  for (const [key, value] of Object.entries(allocation)) {
    if (value > bestValue) {
      best = key;
      bestValue = value;
    }
  }
  return best === "" ? "no allocation" : `${best} leads`;
}

export function turnDelta(turns: MatchTurn[], activeTurn: number): string {
  const current = turns.find((entry) => entry.turn === activeTurn) ?? turns[0];
  if (current === undefined) {
    return `Turn ${String(activeTurn)} of 12 · no turns yet`;
  }
  if (current.skip_reason !== null) {
    return `Turn ${String(current.turn)} of 12 · skipped — ${current.skip_reason}`;
  }
  const previous = turns.find((entry) => entry.turn === current.turn - 1);
  const swing =
    previous?.skip_reason === null ? fmtSwing(current.spend, previous.spend) : "";
  return (
    `Turn ${String(current.turn)} of 12 · ${leadKey(current.allocation)} · ` +
    `${fmtSpend(current.spend)} spend${swing} · ${formatTokensWithThinking(current.tokens_used, current.thinking_tokens)} tokens`
  );
}
