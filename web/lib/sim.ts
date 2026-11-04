/** Typed client for the sim API. Server-side only: never import from components. */
import type { FieldIntervention } from "./field-plan";
import { SIM_START_HINT, DEFAULT_SIM_URL, resolveEndpoints } from "./env";
import { SimApiError, simFetch, readJson } from "./http";

export interface ModelInfo {
  id: string;
  kind: "local" | "hosted";
}

export interface SimContract {
  sim_version: string;
  turns: number;
  prompt_max_words: number;
  token_budget: number;
  turn_token_cap: number;
  models: ModelInfo[];
}

export interface MatchTurn {
  turn: number;
  state_hash: string;
  skip_reason: string | null;
  tokens_used: number;
  /** Measured thinking trace; absent on turns recorded before it shipped. */
  thinking_tokens?: number;
  usage_anomaly: boolean;
  spend: number;
  allocation: Record<string, number> | null;
  policies: string[];
  /** Kind fired this turn; absent on replays recorded before field plans. */
  intervention?: string | null;
  /** Running boards; absent on replays recorded before race timing. */
  impact?: number;
  efficiency?: number;
}

export interface StrategyFingerprint {
  mean_allocation: Record<string, number>;
  policies: Record<string, number>;
  played_turns: number;
  skipped_turns: number;
}

export interface EnvironmentCell {
  site: string;
  index: number;
  soil: string;
  slope: number;
  moisture: number;
  fertility: number;
  heat: number;
  erosion: number;
  feature: "rock" | "vent" | "flora" | "barren";
}

export interface EnvironmentTraceEntry {
  turn: number;
  restoration: string | null;
  moisture: number;
  fertility: number;
  heat: number;
  erosion: number;
  health: Record<string, number>;
  features: Record<string, number>;
  stewardship_bias: number;
}

export interface EnvironmentReport {
  sites: Record<string, EnvironmentCell[]>;
  site_health: Record<string, number>;
  summary: Record<string, number>;
  features: Record<string, number>;
  stewardship_bias: number;
  restoration: {
    weather: string;
    turns: number[];
    magnitude: number;
    replay_seconds: number;
  };
  prioritization: number;
  trace: EnvironmentTraceEntry[];
}

/**
 * Sim-signed run receipt: binds the scored fields so the board can
 * verify them. Present only when the sim was configured with the
 * shared receipt secret; forward verbatim, never reshape.
 */
export interface SimReceipt {
  payload: string;
  sig: string;
}

export interface MatchResultPayload {
  seed: number;
  provider: string;
  scores: Record<string, number>;
  totals: Record<string, number>;
  loss_reasons: string[];
  turns: MatchTurn[];
  badges: string[];
  strategy: StrategyFingerprint;
  prompt_words: number;
  token_budget: number;
  environment?: EnvironmentReport;
  chaos_level?: number;
  receipt?: SimReceipt;
}

// Re-export for backwards compatibility with tests
/** Ordered sim endpoints: comma-separated SIM_API_URL, cloud first. */
export function resolveSimUrls(raw: string | undefined): string[] {
  return resolveEndpoints(raw, DEFAULT_SIM_URL);
}

export function resolveSimUrl(raw: string | undefined): string {
  return resolveSimUrls(raw)[0] ?? DEFAULT_SIM_URL;
}

// Re-exported so API routes can import them from this module as before.
export { SIM_START_HINT, SimApiError };

export async function getContract(): Promise<SimContract> {
  const response = await simFetch("/contract", { cache: "no-store" });
  const body: unknown = await readJson(response);
  if (!response.ok) {
    throw new SimApiError(response.status, "sim API contract request failed");
  }
  return body as SimContract;
}

export interface MatchOptions {
  uid?: string;
  providerKey?: string;
  promptMaxWords?: number;
  tokenBudget?: number;
  interventions?: FieldIntervention[];
  challengeParams?: Record<string, unknown>;
  /** Fourier chaos level in 0..1; omitted replays the legacy world. */
  chaosLevel?: number;
}

export interface ToteItem {
  id: string;
  label: string;
  weight: number;
  value: number;
  fragile: boolean;
  tags: string[];
}

export interface ToteCatalog {
  capacity_kg: number;
  items: ToteItem[];
}

export interface ToteOffer {
  seed: number;
  capacity_kg: number;
  offered: string[];
  scarce: string[];
}

export interface ToteDamage {
  overweight: number;
  crush: number;
  stain: number;
  cut: number;
  total: number;
}

export interface TotePackResult {
  seed: number;
  provider: string;
  uid: string;
  offered: string[];
  packing: string[];
  value: number;
  damage: ToteDamage;
  score: number;
  totals: { tokens_used: number; thinking_tokens?: number };
  invalid_reason: string | null;
  scarce: string[];
  wildcards: string[];
  badges: string[];
  bonus: number;
  usage_anomaly: boolean;
  receipt?: SimReceipt;
}

/** Human message for a raw sim rejection body; shared by proxy and direct callers. */
export function simRejectionMessage(body: unknown, model: string): string {
  const record =
    typeof body === "object" && body !== null
      ? (body as Record<string, unknown>)
      : undefined;
  const nested =
    typeof record?.detail === "object" && record.detail !== null
      ? (record.detail as Record<string, unknown>)
      : undefined;
  const code = record?.error ?? nested?.error;
  if (code === "prompt_too_long") {
    return "prompt exceeds the word cap";
  }
  if (code === "unknown_model") {
    return `unknown model "${model}" — pick one the sim lists`;
  }
  if (code === "missing_key") {
    return `add your own key for "${model}" under Connect a bot first`;
  }
  if (code === "bad_limits") {
    return "match limits must be positive integers within the sim's caps";
  }
  if (code === "bad_history") {
    return "prior games must be at most 3 summaries of 200 words each";
  }
  if (code === "bad_interventions") {
    return "field plan must hold at most 3 entries, one per turn";
  }
  if (code === "invalid_draft") {
    return "model did not return valid dressing";
  }
  if (code === "bad_draft") {
    return "dressing brief must be at most 2000 characters";
  }
  if (code === "bad_chaos_level") {
    return "chaos level must sit between 0 and 1";
  }
  return "sim API rejected the request";
}

/**
 * Human cause for a sim failure code, or null when unknown. The sim
 * only ever sends this closed set — never exception text — so every
 * entry here is safe to show and anything else falls back to the
 * generic status message (including older sims that send no code).
 */
export function simFailureMessage(reason: unknown): string | null {
  if (reason === "unreachable") {
    return "the model runtime is not answering — is Ollama or LM Studio running?";
  }
  if (reason === "timeout") {
    return "the model took too long to answer";
  }
  if (reason === "model_missing") {
    return "the runtime does not have that model loaded";
  }
  if (reason === "rejected") {
    return "the runtime rejected the request";
  }
  if (reason === "empty_reply") {
    return "the model returned an empty reply";
  }
  return null;
}

function rejectionFor(body: unknown, model: string): SimApiError {
  const base = simRejectionMessage(body, model);
  const record =
    typeof body === "object" && body !== null
      ? (body as Record<string, unknown>)
      : undefined;
  const nested =
    typeof record?.detail === "object" && record.detail !== null
      ? (record.detail as Record<string, unknown>)
      : undefined;
  // Invalid drafts carry our own validation message as detail — safe to show.
  if (nested?.error === "invalid_draft" && typeof nested.detail === "string") {
    return new SimApiError(422, `${base}: ${nested.detail}`);
  }
  return new SimApiError(422, base);
}

function matchHeaders(options?: MatchOptions): Record<string, string> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (options?.providerKey !== undefined) {
    headers["x-provider-key"] = options.providerKey;
  }
  return headers;
}

function matchBody(
  prompt: string,
  seed: number,
  model: string,
  options?: MatchOptions,
): string {
  return JSON.stringify({
    prompt,
    seed,
    model,
    uid: options?.uid ?? "",
    ...(options?.promptMaxWords === undefined
      ? {}
      : { prompt_max_words: options.promptMaxWords }),
    ...(options?.tokenBudget === undefined
      ? {}
      : { token_budget: options.tokenBudget }),
    ...(options?.interventions === undefined
      ? {}
      : { interventions: options.interventions }),
    ...(options?.challengeParams === undefined
      ? {}
      : { challenge_params: options.challengeParams }),
    ...(options?.chaosLevel === undefined ? {} : { chaos_level: options.chaosLevel }),
  });
}

export async function runMatch(
  prompt: string,
  seed: number,
  model: string,
  options?: MatchOptions,
): Promise<MatchResultPayload> {
  const response = await simFetch("/matches/run", {
    method: "POST",
    headers: matchHeaders(options),
    body: matchBody(prompt, seed, model, options),
    cache: "no-store",
  });
  const body: unknown = await readJson(response);
  if (response.status === 422) {
    throw rejectionFor(body, model);
  }
  if (!response.ok) {
    throw new SimApiError(response.status, "sim API match request failed");
  }
  return body as MatchResultPayload;
}

/**
 * Open a streaming match on the sim; the caller reads the event
 * stream. The raw response passes through untouched so turns arrive
 * as they settle — never buffered into one late payload.
 */
export async function postMatchStream(
  prompt: string,
  seed: number,
  model: string,
  options?: MatchOptions,
): Promise<Response> {
  return await simFetch("/matches/stream", {
    method: "POST",
    headers: matchHeaders(options),
    body: matchBody(prompt, seed, model, options),
    cache: "no-store",
  });
}

export interface WhatIfResult {
  turn: number;
  baseline: Record<string, number>;
  variant: Record<string, number>;
  impact_delta: number;
}

/** Preview one swapped allocation; no provider call, no token burn. */
export async function runWhatIf(
  seed: number,
  allocations: (Record<string, number> | null)[],
  turn: number,
  allocation: Record<string, number>,
): Promise<WhatIfResult> {
  const response = await simFetch("/matches/what-if", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ seed, allocations, turn, allocation }),
    cache: "no-store",
  });
  const body: unknown = await readJson(response);
  if (!response.ok) {
    throw new SimApiError(response.status, "sim API what-if request failed");
  }
  return body as WhatIfResult;
}

export interface AssetDraftResult {
  /** Raw dressing params; consumers must parse before use. */
  params: unknown;
  provider: string;
  model: string;
  tokens_used: number;
}

export interface JudgeResult {
  /** Raw verdict; consumers must parse before use. */
  verdict: unknown;
  provider: string;
  model: string;
  tokens_used: number;
}

/** One rubric-bound judge call on the player's own model. */
export async function judgePrompt(
  prompt: string,
  model: string,
  options?: MatchOptions,
): Promise<JudgeResult> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (options?.providerKey !== undefined) {
    headers["x-provider-key"] = options.providerKey;
  }
  const response = await simFetch("/prompt/judge", {
    method: "POST",
    headers,
    body: JSON.stringify({ prompt, model, uid: options?.uid ?? "" }),
    cache: "no-store",
  });
  const body: unknown = await readJson(response);
  if (response.status === 422) {
    throw rejectionFor(body, model);
  }
  if (!response.ok) {
    throw new SimApiError(response.status, "sim API judge request failed");
  }
  return body as JudgeResult;
}

export async function draftAssets(
  prompt: string,
  model: string,
  options?: MatchOptions,
): Promise<AssetDraftResult> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (options?.providerKey !== undefined) {
    headers["x-provider-key"] = options.providerKey;
  }
  const response = await simFetch("/assets/draft", {
    method: "POST",
    headers,
    body: JSON.stringify({ prompt, model, uid: options?.uid ?? "" }),
    cache: "no-store",
  });
  const body: unknown = await readJson(response);
  if (response.status === 422) {
    throw rejectionFor(body, model);
  }
  if (!response.ok) {
    throw new SimApiError(response.status, "sim API draft request failed");
  }
  return body as AssetDraftResult;
}

export async function getToteCatalog(): Promise<ToteCatalog> {
  const response = await simFetch("/tote/catalog", { cache: "no-store" });
  const body: unknown = await readJson(response);
  if (!response.ok) {
    throw new SimApiError(response.status, "sim API catalog request failed");
  }
  return body as ToteCatalog;
}

export async function getToteOffer(seed: number): Promise<ToteOffer> {
  const response = await simFetch(`/tote/offer?seed=${String(seed)}`, {
    cache: "no-store",
  });
  const body: unknown = await readJson(response);
  if (!response.ok) {
    throw new SimApiError(response.status, "sim API offer request failed");
  }
  return body as ToteOffer;
}

export async function runTotePack(
  prompt: string,
  seed: number,
  model: string,
  options?: MatchOptions,
): Promise<TotePackResult> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (options?.providerKey !== undefined) {
    headers["x-provider-key"] = options.providerKey;
  }
  const response = await simFetch("/tote/pack", {
    method: "POST",
    headers,
    body: JSON.stringify({
      prompt,
      seed,
      model,
      uid: options?.uid ?? "",
      ...(options?.tokenBudget === undefined
        ? {}
        : { token_budget: options.tokenBudget }),
      ...(options?.challengeParams === undefined
        ? {}
        : { challenge_params: options.challengeParams }),
    }),
    cache: "no-store",
  });
  const body: unknown = await readJson(response);
  if (response.status === 422) {
    throw rejectionFor(body, model);
  }
  if (!response.ok) {
    throw new SimApiError(response.status, "sim API tote request failed");
  }
  return body as TotePackResult;
}
