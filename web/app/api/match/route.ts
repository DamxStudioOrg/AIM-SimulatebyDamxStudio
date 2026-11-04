import type { MatchResultPayload } from "@/lib/sim";
import { runMatch } from "@/lib/sim";
import type { MatchRequest } from "@/lib/match-request";
import { isValidMatchRequest } from "@/lib/match-request";
import { createProxy, simErrorMap } from "@/lib/api-proxy";

export const POST = createProxy<MatchRequest, MatchResultPayload>({
  handler: async (input) => {
    return await runMatch(input.prompt, input.seed, input.model ?? "", {
      uid: input.uid,
      providerKey: input.providerKey,
      promptMaxWords: input.promptMaxWords,
      tokenBudget: input.tokenBudget,
      interventions: input.interventions,
      challengeParams: input.challenge_params,
      chaosLevel: input.chaosLevel,
    });
  },
  validate: isValidMatchRequest,
  errorMap: simErrorMap,
});
