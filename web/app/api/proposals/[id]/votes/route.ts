import type { VoteReceipt } from "@/lib/laravel";
import { postVote } from "@/lib/laravel";
import { isValidUid } from "@/lib/vault";
import { createProxy, boardErrorMap } from "@/lib/api-proxy";

interface VoteRequest {
  uid: string;
  receipt?: { payload: string; sig: string };
}

function isVoteRequest(body: unknown): body is VoteRequest {
  if (typeof body !== "object" || body === null) return false;
  const c = body as Record<string, unknown>;
  if (typeof c.uid !== "string" || !isValidUid(c.uid)) return false;
  if (c.receipt === undefined) return true;
  if (typeof c.receipt !== "object" || c.receipt === null) return false;
  const receipt = c.receipt as Record<string, unknown>;
  if (typeof receipt.payload !== "string" || typeof receipt.sig !== "string")
    return false;
  return receipt.payload.length <= 8192 && receipt.sig.length <= 128;
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const proposalId = Number.parseInt(id, 10);
  if (!Number.isInteger(proposalId) || proposalId < 1) {
    return Response.json(
      { error: "proposal id must be a positive integer" },
      { status: 400 },
    );
  }

  const proxy = createProxy<VoteRequest, VoteReceipt>({
    handler: async (input) => postVote(proposalId, input.uid, input.receipt),
    validate: isVoteRequest,
    errorMap: boardErrorMap,
  });

  return proxy(request);
}
