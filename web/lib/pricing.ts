/** Per-run API cost estimates. Blended $/1M tokens over total tokens.

Local runtimes are exactly zero (no API spend). Hosted entries assume a
70/30 input/output split and go stale when providers reprice — verify
against the provider dashboard. Operators can override or extend rates
with NEXT_PUBLIC_COST_RATES as JSON: {"model-id": dollarsPerMillion}.
*/

const TOKENS_PER_MILLION = 1_000_000;
const INPUT_SHARE = 0.7;

interface SplitRate {
  inputPerMillion: number;
  outputPerMillion: number;
}

const DOCUMENTED_RATES: Record<string, SplitRate> = {
  // OpenAI published rates; check https://openai.com/api/pricing/ if old.
  "gpt-4o-mini": { inputPerMillion: 0.15, outputPerMillion: 0.6 },
};

function isLocal(modelId: string): boolean {
  return modelId.startsWith("ollama/") || modelId.startsWith("local/");
}

function envOverrides(): Record<string, number> {
  const raw = process.env.NEXT_PUBLIC_COST_RATES;
  if (raw === undefined || raw === "") {
    return {};
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) {
      return {};
    }
    const out: Record<string, number> = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
        out[key] = value;
      }
    }
    return out;
  } catch {
    return {};
  }
}

/** Blended $/1M or null when no rate is known. Local is always zero. */
export function blendedRatePerMillion(modelId: string): number | null {
  if (isLocal(modelId)) {
    return 0;
  }
  const override = envOverrides()[modelId];
  if (override !== undefined) {
    return override;
  }
  const split = DOCUMENTED_RATES[modelId];
  if (split === undefined) {
    return null;
  }
  return (
    INPUT_SHARE * split.inputPerMillion + (1 - INPUT_SHARE) * split.outputPerMillion
  );
}

/**
 * True token spend: gameplay tokens plus the thinking trace. Gameplay
 * budgets bill the answer only, but providers bill the trace too, so
 * cost always prices this total — never the gameplay slice alone.
 */
export function trueTokenTotal(gameTokens: number, thinkingTokens?: number): number {
  return gameTokens + (thinkingTokens ?? 0);
}

/**
 * "7,626" for plain replies, "7,626 (+3,102 thinking)" when the trace
 * is nonzero. Absent reads as zero so old sims and replays render
 * the bare count they always did.
 */
export function formatTokensWithThinking(
  gameTokens: number,
  thinkingTokens?: number,
): string {
  const game = gameTokens.toLocaleString("en-US");
  const thinking = thinkingTokens ?? 0;
  if (thinking <= 0) {
    return game;
  }
  return `${game} (+${thinking.toLocaleString("en-US")} thinking)`;
}

/**
 * Estimated dollars for a run, or null when no rate is known. Pass
 * true totals (gameplay + thinking) — the trace is real spend.
 */
export function estimateCostUsd(tokens: number, modelId: string): number | null {
  const rate = blendedRatePerMillion(modelId);
  if (rate === null) {
    return null;
  }
  return (tokens / TOKENS_PER_MILLION) * rate;
}
