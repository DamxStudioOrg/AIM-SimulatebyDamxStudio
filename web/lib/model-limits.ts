/**
 * Per-model prompt and context allowances: how much prompting and
 * context each model may spend on a task. The sim contract only
 * names models (`{id, kind}`), so the client maps kinds to
 * allowances — small local runtimes run a tighter leash than
 * hosted frontier models. Challenges still cap from above: the
 * effective limit is the model's allowance in open play, and the
 * min of challenge and model on a task. Unknown models (or none
 * selected yet) constrain nothing and fall back to contract
 * defaults. Pure mapping; use-match applies it.
 */

export interface ModelLimits {
  /** Prompt word allowance for one run. */
  words: number;
  /** Match token budget for one run. */
  tokenBudget: number;
}

const KIND_LIMITS: Record<string, ModelLimits> = {
  local: { words: 150, tokenBudget: 8000 },
  hosted: { words: 300, tokenBudget: 20000 },
};

/**
 * Allowance for one model id/kind, or null when the model is
 * unknown (contract still loading, id unlisted): no constraint.
 */
export function limitsForModel(
  modelId: string,
  kind: string | undefined,
): ModelLimits | null {
  if (modelId === "" || kind === undefined) {
    return null;
  }
  return KIND_LIMITS[kind] ?? null;
}

/** Compact allowance for model picker labels: `≤150w · ≤8k`. */
export function allowanceLabel(allowance: ModelLimits): string {
  const budget = allowance.tokenBudget;
  const k = budget % 1000 === 0 ? String(budget / 1000) : (budget / 1000).toFixed(1);
  return `≤${String(allowance.words)}w · ≤${k}k`;
}

/**
 * Effective task limits: the model's allowance in open play, the
 * min of challenge and model on a task. Rank bonus applies after,
 * in the caller, exactly as before.
 */
export function effectiveLimits(args: {
  challenge?: { words: number; tokenBudget: number };
  model: ModelLimits | null;
  contract?: { prompt_max_words: number; token_budget: number };
}): ModelLimits {
  const fallbackWords = args.contract?.prompt_max_words ?? 250;
  const fallbackBudget = args.contract?.token_budget ?? 15000;
  if (args.challenge === undefined) {
    return {
      words: args.model?.words ?? fallbackWords,
      tokenBudget: args.model?.tokenBudget ?? fallbackBudget,
    };
  }
  return {
    words: Math.min(args.challenge.words, args.model?.words ?? args.challenge.words),
    tokenBudget: Math.min(
      args.challenge.tokenBudget,
      args.model?.tokenBudget ?? args.challenge.tokenBudget,
    ),
  };
}
