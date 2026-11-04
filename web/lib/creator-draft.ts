import type { ChallengeAssets } from "./asset-schema";
import { parseChallengeAssets } from "./asset-schema";

/**
 * Creator draft autosave: the proposal form survives mode hops,
 * navigation, and reloads, so simulating a draft never eats it.
 * Restored dressing re-parses like any untrusted JSON; the token
 * count of the drafting call is display-only and never persists.
 */

export const CREATOR_DRAFT_KEY = "aim-creator-draft";

/** Generous storage ceiling per field; the form's own maxima rule input. */
const MAX_DRAFT_FIELD = 8000;

export interface CreatorDraft {
  title: string;
  description: string;
  model: string;
  inputPrompt: string;
  outputFormat: string;
  restrictions: string;
  brief: string;
  dressModel: string;
  dressing: ChallengeAssets | null;
}

function cleanText(value: unknown): string {
  return typeof value === "string" ? value.slice(0, MAX_DRAFT_FIELD) : "";
}

/** Parse a stored draft; null when missing or malformed. */
export function parseCreatorDraft(raw: string | null): CreatorDraft | null {
  if (raw === null || raw === "") {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return null;
  }
  const candidate = parsed as Record<string, unknown>;
  const dressing = parseChallengeAssets(candidate.dressing ?? null);
  return {
    title: cleanText(candidate.title),
    description: cleanText(candidate.description),
    model: cleanText(candidate.model),
    inputPrompt: cleanText(candidate.inputPrompt),
    outputFormat: cleanText(candidate.outputFormat),
    restrictions: cleanText(candidate.restrictions),
    brief: cleanText(candidate.brief),
    dressModel: cleanText(candidate.dressModel),
    dressing: dressing.ok ? dressing.value : null,
  };
}

/** Serialize a draft for storage. */
export function serializeCreatorDraft(draft: CreatorDraft): string {
  return JSON.stringify({
    title: draft.title,
    description: draft.description,
    model: draft.model,
    inputPrompt: draft.inputPrompt,
    outputFormat: draft.outputFormat,
    restrictions: draft.restrictions,
    brief: draft.brief,
    dressModel: draft.dressModel,
    dressing: draft.dressing,
  });
}
