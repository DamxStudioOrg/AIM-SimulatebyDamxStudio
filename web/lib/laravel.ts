/** Typed client for the Laravel live-board API. Server-side only. */
import { isHttpUrl } from "./app-update";
import { LARAVEL_START_HINT, DEFAULT_LARAVEL_URL } from "./env";
import { LaravelError, boardFetch, readBoardJson } from "./http";

// Re-export for backwards compatibility
export { LaravelError, LARAVEL_START_HINT, DEFAULT_LARAVEL_URL };

export function resolveLaravelUrlCompat(raw: string | undefined): string {
  return raw && raw.trim() !== "" ? raw : DEFAULT_LARAVEL_URL;
}

/** Sim-signed run receipt, forwarded verbatim to the board. */
export interface BoardReceipt {
  payload: string;
  sig: string;
}

export interface BoardSubmission {
  uid: string;
  game: string;
  challenge?: string;
  seed: number;
  model: string;
  provider: string;
  nickname?: string;
  badges?: string[];
  strategy?: Record<string, unknown>;
  impact?: number;
  efficiency?: number;
  score?: number;
  details?: Record<string, unknown>;
  receipt?: BoardReceipt;
}

export interface BoardSubmitResult {
  id: number;
  position: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export async function postRun(submission: BoardSubmission): Promise<BoardSubmitResult> {
  const response = await boardFetch("/api/runs", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(submission),
    cache: "no-store",
  });
  const body: unknown = await readBoardJson(response);
  if (response.status === 422) {
    throw new LaravelError(422, "board API rejected the run JSON");
  }
  if (!response.ok) {
    throw new LaravelError(response.status, "board API run request failed");
  }
  if (
    !isRecord(body) ||
    typeof body.id !== "number" ||
    typeof body.position !== "number"
  ) {
    throw new LaravelError(502, "board API returned a bad run receipt");
  }
  return { id: body.id, position: body.position };
}

export interface BoardQuery {
  game: string;
  metric: string;
  limit?: number;
  uid?: string;
  challenge?: string;
}

export interface ProposalInput {
  uid: string;
  nickname?: string;
  title: string;
  description: string;
  model: string;
  input_prompt: string;
  output_format: string;
  restrictions?: string;
  assets?: unknown;
}

export interface ProposalPayload {
  id: number;
  uid: string;
  nickname: string | null;
  title: string;
  description: string;
  model: string;
  input_prompt: string;
  output_format: string;
  restrictions: string | null;
  assets?: unknown;
  votes: number;
  weighted_votes: number;
  featured: boolean;
  created_at: string | null;
}

function isProposal(value: unknown): value is ProposalPayload {
  if (!isRecord(value)) {
    return false;
  }
  if (
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

export async function postProposal(input: ProposalInput): Promise<ProposalPayload> {
  const response = await boardFetch("/api/challenges/proposals", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
    cache: "no-store",
  });
  const body: unknown = await readBoardJson(response);
  if (response.status === 422 || response.status === 429) {
    throw new LaravelError(
      response.status,
      boardError(body, "board API rejected the proposal"),
    );
  }
  if (!response.ok) {
    throw new LaravelError(response.status, "board API proposal request failed");
  }
  if (!isProposal(body)) {
    throw new LaravelError(502, "board API returned a bad proposal");
  }
  return body;
}

export async function getProposals(): Promise<ProposalPayload[]> {
  const response = await boardFetch("/api/challenges/proposals", {
    cache: "no-store",
  });
  const body: unknown = await readBoardJson(response);
  if (!response.ok) {
    throw new LaravelError(response.status, "board API proposals request failed");
  }
  if (!isRecord(body) || !Array.isArray(body.proposals)) {
    throw new LaravelError(502, "board API returned a bad proposal list");
  }
  return body.proposals.filter(isProposal);
}

export interface VoteReceipt {
  weight: number;
  base: number;
  badges: number;
  top3: boolean;
}

function boardError(body: unknown, fallback: string): string {
  if (isRecord(body)) {
    if (typeof body.error === "string") {
      return body.error;
    }
    // Laravel throttle/validation failures speak through `message`.
    if (typeof body.message === "string") {
      return body.message;
    }
  }
  return fallback;
}

export async function postVote(
  proposalId: number,
  uid: string,
  receipt?: BoardReceipt,
): Promise<VoteReceipt> {
  const response = await boardFetch(
    `/api/challenges/proposals/${String(proposalId)}/votes`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(receipt === undefined ? { uid } : { uid, receipt }),
      cache: "no-store",
    },
  );
  const body: unknown = await readBoardJson(response);
  if (response.status === 422 || response.status === 409 || response.status === 429) {
    throw new LaravelError(
      response.status,
      boardError(body, "board API rejected the vote"),
    );
  }
  if (!response.ok) {
    throw new LaravelError(response.status, "board API vote request failed");
  }
  if (
    !isRecord(body) ||
    typeof body.weight !== "number" ||
    !isRecord(body.breakdown) ||
    typeof body.breakdown.base !== "number" ||
    typeof body.breakdown.badges !== "number" ||
    typeof body.breakdown.top3 !== "boolean"
  ) {
    throw new LaravelError(502, "board API returned a bad vote receipt");
  }
  return {
    weight: body.weight,
    base: body.breakdown.base,
    badges: body.breakdown.badges,
    top3: body.breakdown.top3,
  };
}

export interface BoardVersion {
  version: string;
  url: string;
  notes: string;
}

/** Shipped desktop version; the URL must be absolute http(s). */
export async function boardVersion(): Promise<BoardVersion> {
  const response = await boardFetch("/api/app/version", { cache: "no-store" });
  const body: unknown = await readBoardJson(response);
  if (!response.ok) {
    throw new LaravelError(response.status, "board API version request failed");
  }
  if (
    !isRecord(body) ||
    typeof body.version !== "string" ||
    !isHttpUrl(body.url) ||
    typeof body.notes !== "string"
  ) {
    throw new LaravelError(502, "board API returned a bad version payload");
  }
  return { version: body.version, url: body.url, notes: body.notes };
}

export async function getBoard(query: BoardQuery): Promise<unknown> {
  const params = new URLSearchParams({ game: query.game, metric: query.metric });
  if (query.limit !== undefined) {
    params.set("limit", String(query.limit));
  }
  if (query.uid !== undefined) {
    params.set("uid", query.uid);
  }
  if (query.challenge !== undefined && query.challenge !== "") {
    params.set("challenge", query.challenge);
  }
  const response = await boardFetch(`/api/leaderboard?${params.toString()}`, {
    cache: "no-store",
  });
  const body: unknown = await readBoardJson(response);
  if (response.status === 422) {
    throw new LaravelError(422, "board API rejected the board query");
  }
  if (!response.ok) {
    throw new LaravelError(response.status, "board API board request failed");
  }
  return body;
}
