import type { MatchResultPayload, MatchTurn } from "@/lib/sim";

/** Shared demo match: the attract-loop city shown before the first run. */

export const DEMO_PROMPT =
  "Hold reserves, fund clinics early, and move fast when the water rises.";

const DEMO_ALLOCATION: Record<string, number> = {
  housing: 15,
  transit: 10,
  health: 15,
  green: 10,
  reserves: 15,
  rescue: 12,
  shelter: 11,
  repair: 12,
};

const DEMO_TURNS: MatchTurn[] = Array.from({ length: 12 }, (_, index) => ({
  turn: index + 1,
  state_hash: `demo-hash-${String(index + 1)}`,
  skip_reason: null,
  tokens_used: 278,
  usage_anomaly: false,
  spend: 105000,
  allocation: { ...DEMO_ALLOCATION },
  policies: [],
}));

export const DEMO_RESULT: MatchResultPayload = {
  seed: 7,
  provider: "demo",
  scores: { impact: 50.25, efficiency: 13.4 },
  totals: { tokens_used: 3336, spend: 1260000, usage_anomalies: 0 },
  loss_reasons: ["412 lives lost to the turn-9 heatwave"],
  turns: DEMO_TURNS,
  badges: [],
  strategy: {
    mean_allocation: { ...DEMO_ALLOCATION },
    policies: {},
    played_turns: 12,
    skipped_turns: 0,
  },
  prompt_words: 12,
  token_budget: 15000,
};
