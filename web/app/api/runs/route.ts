import type { BoardSubmission, BoardSubmitResult } from "@/lib/laravel";
import { postRun } from "@/lib/laravel";
import { isValidUid } from "@/lib/vault";
import { createProxy, boardErrorMap } from "@/lib/api-proxy";

const GAMES = ["city", "tote"];

function isRunBody(body: unknown): body is BoardSubmission {
  if (typeof body !== "object" || body === null) return false;
  const c = body as Record<string, unknown>;
  if (
    typeof c.uid !== "string" ||
    !GAMES.includes(c.game as string) ||
    typeof c.seed !== "number" ||
    !Number.isInteger(c.seed) ||
    typeof c.model !== "string" ||
    typeof c.provider !== "string"
  )
    return false;
  for (const key of ["impact", "efficiency", "score"] as const) {
    const v = c[key];
    if (v !== undefined && typeof v !== "number") return false;
  }
  if (
    c.nickname !== undefined &&
    (typeof c.nickname !== "string" || c.nickname.length > 32)
  )
    return false;
  if (
    c.challenge !== undefined &&
    (typeof c.challenge !== "string" || c.challenge.length > 64)
  )
    return false;
  if (
    c.badges !== undefined &&
    (!Array.isArray(c.badges) ||
      c.badges.length > 8 ||
      c.badges.some((e: unknown) => typeof e !== "string" || e.length > 32))
  )
    return false;
  if (
    c.strategy !== undefined &&
    (typeof c.strategy !== "object" || c.strategy === null)
  )
    return false;
  if (c.details !== undefined && (typeof c.details !== "object" || c.details === null))
    return false;
  if (c.receipt !== undefined) {
    if (typeof c.receipt !== "object" || c.receipt === null) return false;
    const receipt = c.receipt as Record<string, unknown>;
    if (typeof receipt.payload !== "string" || typeof receipt.sig !== "string")
      return false;
    if (receipt.payload.length > 8192 || receipt.sig.length > 128) return false;
  }
  if (c.game === "city")
    return typeof c.impact === "number" && typeof c.efficiency === "number";
  return typeof c.score === "number";
}

export const POST = createProxy<BoardSubmission, BoardSubmitResult>({
  handler: async (input) => {
    const receipt = await postRun(input);
    return receipt;
  },
  validate: isRunBody,
  validateUid: (uid) => !!uid && isValidUid(uid),
  errorMap: boardErrorMap,
});
