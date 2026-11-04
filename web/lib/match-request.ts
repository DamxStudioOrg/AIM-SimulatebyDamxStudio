import { recordOf } from "./body";
import { isValidUid } from "./vault";

/** Armed challenge echoed to the sim; shared by the blocking and stream proxies. */
// eslint-disable-next-line @typescript-eslint/consistent-type-definitions -- a type keeps the implicit index signature the sim client's Record<string, unknown> options need; an interface breaks that assignment.
export type MatchChallengeParams = {
  kind: string;
  id: string;
  seed: number;
  goals: Record<string, unknown>;
};

/** Match run submission; shared by the blocking and stream proxies. */
export interface MatchRequest {
  prompt: string;
  seed: number;
  model?: string;
  uid?: string;
  providerKey?: string;
  promptMaxWords?: number;
  tokenBudget?: number;
  interventions?: { turn: number; kind: string }[];
  challenge_params?: MatchChallengeParams;
  chaosLevel?: number;
}

function isFieldPlan(value: unknown): value is { turn: number; kind: string }[] {
  if (!Array.isArray(value) || value.length > 3) return false;
  return value.every((e) => {
    if (typeof e !== "object" || e === null) return false;
    const entry = e as Record<string, unknown>;
    return Number.isInteger(entry.turn) && typeof entry.kind === "string";
  });
}

function isChallengeParams(value: unknown): value is MatchChallengeParams {
  const c = recordOf(value);
  if (c === null) return false;
  if (
    (c.kind !== "city" && c.kind !== "tote") ||
    typeof c.id !== "string" ||
    c.id.length === 0 ||
    c.id.length > 64 ||
    typeof c.seed !== "number" ||
    !Number.isInteger(c.seed)
  )
    return false;
  return recordOf(c.goals) !== null;
}

export function isValidMatchRequest(body: unknown): body is MatchRequest {
  const c = recordOf(body);
  if (c === null) return false;
  if (
    typeof c.prompt !== "string" ||
    typeof c.seed !== "number" ||
    (c.model !== undefined && typeof c.model !== "string") ||
    (c.uid !== undefined && typeof c.uid !== "string") ||
    (c.providerKey !== undefined && typeof c.providerKey !== "string") ||
    (c.promptMaxWords !== undefined && typeof c.promptMaxWords !== "number") ||
    (c.tokenBudget !== undefined && typeof c.tokenBudget !== "number") ||
    (c.interventions !== undefined && !isFieldPlan(c.interventions)) ||
    (c.challenge_params !== undefined && !isChallengeParams(c.challenge_params)) ||
    (c.chaosLevel !== undefined &&
      (typeof c.chaosLevel !== "number" ||
        !Number.isFinite(c.chaosLevel) ||
        c.chaosLevel < 0 ||
        c.chaosLevel > 1))
  )
    return false;
  if (c.uid !== undefined && !isValidUid(c.uid)) return false;
  if (
    c.providerKey !== undefined &&
    (c.providerKey.trim() === "" || c.providerKey.length > 2000)
  )
    return false;
  for (const limit of [c.promptMaxWords, c.tokenBudget]) {
    if (limit !== undefined && (!Number.isInteger(limit) || limit <= 0)) return false;
  }
  return true;
}
