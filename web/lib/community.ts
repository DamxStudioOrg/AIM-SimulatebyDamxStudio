/** Client calls for the community Challenge Creator, via Next proxies. */
import type { ChallengeAssets } from "./asset-schema";
import { parseChallengeAssets } from "./asset-schema";
import type { HistoryEntry } from "./history";
import { isOffline } from "./online";

/** Sim-signed run receipt, forwarded verbatim to the board. */
export interface VoteReceiptProof {
  payload: string;
  sig: string;
}

/**
 * Newest sim receipt for one uid in local history, if any. Boards
 * that require verified votes accept this as proof the voter ran.
 */
export function latestReceiptForUid(
  history: HistoryEntry[],
  uid: string,
): VoteReceiptProof | null {
  for (const entry of history) {
    if (entry.uid !== uid || entry.result === undefined) {
      continue;
    }
    const receipt = entry.result.receipt;
    if (
      receipt !== undefined &&
      typeof receipt.payload === "string" &&
      typeof receipt.sig === "string"
    ) {
      return { payload: receipt.payload, sig: receipt.sig };
    }
  }
  return null;
}

export interface CommunityProposal {
  id: number;
  uid: string;
  nickname: string | null;
  title: string;
  description: string;
  model: string;
  input_prompt: string;
  output_format: string;
  restrictions: string | null;
  /** Raw dressing params; parse with parseChallengeAssets before use. */
  assets?: unknown;
  votes: number;
  weighted_votes: number;
  featured: boolean;
  created_at: string | null;
}

export interface ProposalDraft {
  uid: string;
  nickname?: string;
  title: string;
  description: string;
  model: string;
  input_prompt: string;
  output_format: string;
  restrictions?: string;
  assets?: ChallengeAssets;
}

export interface VoteReceipt {
  weight: number;
  base: number;
  badges: number;
  top3: boolean;
}

export type CommunityResult<T> = { ok: true; value: T } | { ok: false; error: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isProposal(value: unknown): value is CommunityProposal {
  if (
    !isRecord(value) ||
    typeof value.id !== "number" ||
    typeof value.uid !== "string" ||
    typeof value.title !== "string" ||
    typeof value.description !== "string" ||
    typeof value.model !== "string" ||
    typeof value.input_prompt !== "string" ||
    typeof value.output_format !== "string" ||
    typeof value.votes !== "number" ||
    typeof value.weighted_votes !== "number" ||
    typeof value.featured !== "boolean"
  ) {
    return false;
  }
  const assets = value.assets;
  return assets === undefined || assets === null || isRecord(assets);
}

function apiError(body: unknown, fallback: string): string {
  if (isRecord(body) && typeof body.error === "string") {
    return body.error;
  }
  return fallback;
}

async function readBody(response: Response): Promise<unknown> {
  try {
    return (await response.json()) as unknown;
  } catch {
    return null;
  }
}

/** All proposals, newest board state; null when the board is unreachable. */
export async function fetchProposals(): Promise<CommunityProposal[] | null> {
  let response: Response;
  try {
    response = await fetch("/api/proposals");
  } catch {
    return null;
  }
  const body: unknown = await readBody(response);
  if (!response.ok || !isRecord(body) || !Array.isArray(body.proposals)) {
    return null;
  }
  return body.proposals.filter(isProposal);
}

export async function proposeProposal(
  draft: ProposalDraft,
): Promise<CommunityResult<CommunityProposal>> {
  if (isOffline()) {
    return { ok: false, error: "You're offline — reconnect to propose." };
  }
  let response: Response;
  try {
    response = await fetch("/api/proposals", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(draft),
    });
  } catch {
    return { ok: false, error: "Board unreachable — is the server running?" };
  }
  const body: unknown = await readBody(response);
  if (!response.ok) {
    return { ok: false, error: apiError(body, "Proposal rejected.") };
  }
  if (!isProposal(body)) {
    return { ok: false, error: "Board returned a bad proposal." };
  }
  return { ok: true, value: body };
}

export interface AssetDraft {
  prompt: string;
  model: string;
  uid: string;
  providerKey?: string;
}

export interface AssetDraftResult {
  params: ChallengeAssets;
  tokens_used: number;
}

/**
 * Draft stage dressing with the creator's own model call. The returned
 * params are re-parsed locally, so only exact-shape dressing reaches
 * the proposal form.
 */
export async function draftAssets(
  draft: AssetDraft,
): Promise<CommunityResult<AssetDraftResult>> {
  if (isOffline()) {
    return { ok: false, error: "You're offline — reconnect to draft." };
  }
  let response: Response;
  try {
    response = await fetch("/api/assets", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(draft),
    });
  } catch {
    return { ok: false, error: "Sim unreachable — is it running?" };
  }
  const body: unknown = await readBody(response);
  if (!response.ok) {
    return { ok: false, error: apiError(body, "Draft rejected.") };
  }
  if (!isRecord(body) || typeof body.tokens_used !== "number") {
    return { ok: false, error: "Sim returned a bad draft." };
  }
  const parsed = parseChallengeAssets(body.params);
  if (!parsed.ok) {
    return { ok: false, error: `Sim returned bad dressing: ${parsed.error}.` };
  }
  return { ok: true, value: { params: parsed.value, tokens_used: body.tokens_used } };
}

export async function voteProposal(
  proposalId: number,
  uid: string,
  receipt?: VoteReceiptProof,
): Promise<CommunityResult<VoteReceipt>> {
  if (isOffline()) {
    return { ok: false, error: "You're offline — reconnect to vote." };
  }
  let response: Response;
  try {
    response = await fetch(`/api/proposals/${String(proposalId)}/votes`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(receipt === undefined ? { uid } : { uid, receipt }),
    });
  } catch {
    return { ok: false, error: "Board unreachable — is the server running?" };
  }
  const body: unknown = await readBody(response);
  if (!response.ok) {
    return { ok: false, error: apiError(body, "Vote rejected.") };
  }
  // The Next proxy flattens the board's nested breakdown, so expect flat.
  if (
    !isRecord(body) ||
    typeof body.weight !== "number" ||
    typeof body.base !== "number" ||
    typeof body.badges !== "number" ||
    typeof body.top3 !== "boolean"
  ) {
    return { ok: false, error: "Board returned a bad vote receipt." };
  }
  return {
    ok: true,
    value: {
      weight: body.weight,
      base: body.base,
      badges: body.badges,
      top3: body.top3,
    },
  };
}
