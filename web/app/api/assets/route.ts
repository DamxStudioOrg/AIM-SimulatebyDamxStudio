import type { AssetDraftResult } from "@/lib/sim";
import { draftAssets } from "@/lib/sim";
import { isValidUid } from "@/lib/vault";
import { createProxy, simErrorMap } from "@/lib/api-proxy";

interface AssetRequest {
  prompt: string;
  model?: string;
  uid?: string;
  providerKey?: string;
}

function isValidAssetRequest(body: unknown): body is AssetRequest {
  if (typeof body !== "object" || body === null) return false;
  const c = body as Record<string, unknown>;
  if (typeof c.prompt !== "string" || c.prompt.trim() === "" || c.prompt.length > 2000)
    return false;
  if (c.model !== undefined && typeof c.model !== "string") return false;
  if (c.uid !== undefined) {
    if (typeof c.uid !== "string" || !isValidUid(c.uid)) return false;
  }
  if (c.providerKey !== undefined) {
    if (
      typeof c.providerKey !== "string" ||
      c.providerKey.trim() === "" ||
      c.providerKey.length > 2000
    )
      return false;
  }
  return true;
}

export const POST = createProxy<AssetRequest, AssetDraftResult>({
  handler: async (input) => {
    return await draftAssets(input.prompt, input.model ?? "", {
      uid: input.uid,
      providerKey: input.providerKey,
    });
  },
  validate: isValidAssetRequest,
  errorMap: simErrorMap,
});
