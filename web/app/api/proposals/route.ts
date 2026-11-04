import type { ProposalInput, ProposalPayload } from "@/lib/laravel";
import { getProposals, postProposal } from "@/lib/laravel";
import { isValidUid } from "@/lib/vault";
import { createProxy, boardErrorMap } from "@/lib/api-proxy";

function isProposalBody(body: unknown): body is ProposalInput {
  if (typeof body !== "object" || body === null) return false;
  const c = body as Record<string, unknown>;
  if (typeof c.uid !== "string" || !isValidUid(c.uid)) return false;
  const required: [string, number][] = [
    ["title", 80],
    ["description", 2000],
    ["model", 64],
    ["input_prompt", 2000],
    ["output_format", 255],
  ];
  for (const [key, max] of required) {
    const v = c[key];
    if (typeof v !== "string" || v.trim() === "" || v.length > max) return false;
  }
  if (
    c.nickname !== undefined &&
    (typeof c.nickname !== "string" || c.nickname.length > 32)
  )
    return false;
  if (
    c.restrictions !== undefined &&
    (typeof c.restrictions !== "string" || c.restrictions.length > 2000)
  )
    return false;
  if (
    c.assets !== undefined &&
    c.assets !== null &&
    (typeof c.assets !== "object" || Array.isArray(c.assets))
  )
    return false;
  return true;
}

/** Live board read: new proposals list immediately. */
export const dynamic = "force-dynamic";

export async function GET() {
  const proposals = await getProposals();
  return Response.json({ proposals });
}

export const POST = createProxy<ProposalInput, ProposalPayload>({
  handler: async (input) => {
    const proposal = await postProposal(input);
    return proposal;
  },
  validate: isProposalBody,
  errorMap: boardErrorMap,
});
