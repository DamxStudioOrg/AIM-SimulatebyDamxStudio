import type { TotePackResult } from "@/lib/sim";
import { getToteCatalog, getToteOffer, runTotePack, SimApiError } from "@/lib/sim";
import { SIM_START_HINT } from "@/lib/env";
import { isValidUid } from "@/lib/vault";
import { createProxy, simErrorMap } from "@/lib/api-proxy";

interface ToteRequest {
  prompt: string;
  seed: number;
  model?: string;
  uid?: string;
  providerKey?: string;
}

function isToteRequest(body: unknown): body is ToteRequest {
  if (typeof body !== "object" || body === null) return false;
  const c = body as Record<string, unknown>;
  return (
    typeof c.prompt === "string" &&
    typeof c.seed === "number" &&
    (c.model === undefined || typeof c.model === "string") &&
    (c.uid === undefined || typeof c.uid === "string") &&
    (c.providerKey === undefined || typeof c.providerKey === "string")
  );
}

function isValidToteRequest(body: unknown): boolean {
  if (!isToteRequest(body)) return false;
  const c = body;
  if (c.uid !== undefined && !isValidUid(c.uid)) return false;
  if (
    c.providerKey !== undefined &&
    (c.providerKey.trim() === "" || c.providerKey.length > 2000)
  )
    return false;
  return true;
}

function isPackResult(body: unknown): body is TotePackResult {
  if (typeof body !== "object" || body === null) return false;
  const c = body as Record<string, unknown>;
  const damage = c.damage as Record<string, unknown> | null;
  return (
    typeof c.seed === "number" &&
    typeof c.provider === "string" &&
    Array.isArray(c.offered) &&
    Array.isArray(c.packing) &&
    typeof c.value === "number" &&
    typeof damage === "object" &&
    damage !== null &&
    typeof damage.total === "number" &&
    typeof c.score === "number" &&
    (c.invalid_reason === null || typeof c.invalid_reason === "string")
  );
}

function simError(error: unknown) {
  if (error instanceof SimApiError) {
    const body: Record<string, string> = { error: error.message };
    if (error.status >= 500) body.hint = SIM_START_HINT;
    return { status: error.status, body };
  }
  throw error;
}

/** Live sim read: offers rotate with the seed. */
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const view = params.get("view") ?? "offer";
  try {
    if (view === "catalog") return Response.json(await getToteCatalog());
    if (view === "offer") {
      const seed = Number.parseInt(params.get("seed") ?? "1", 10);
      if (!Number.isInteger(seed))
        return Response.json({ error: "seed must be an integer" }, { status: 400 });
      return Response.json(await getToteOffer(seed));
    }
    return Response.json({ error: "view must be offer|catalog" }, { status: 400 });
  } catch (e) {
    const err = simError(e);
    return Response.json(err.body, { status: err.status });
  }
}

export const POST = createProxy<ToteRequest, TotePackResult>({
  handler: async (input) => {
    const result = await runTotePack(input.prompt, input.seed, input.model ?? "", {
      uid: input.uid,
      providerKey: input.providerKey,
    });
    if (!isPackResult(result)) {
      throw new Error("bad packing");
    }
    return result;
  },
  validate: isValidToteRequest,
  errorMap: simErrorMap,
});
