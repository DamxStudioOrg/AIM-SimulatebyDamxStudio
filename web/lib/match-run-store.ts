/**
 * Background run store: match and tote-pack runs live here, not in
 * the console route, so opening another menu no longer cancels them.
 * The console adopts the live session on mount (progress keeps
 * ticking, the verdict lands in place); a layout-level toast reports
 * completions that settle while the player browses elsewhere.
 *
 * One writer per kind: a second start while a run is in flight joins
 * the live run instead of queueing another (batch callers await the
 * same promise, so sequential scripts keep their ordering).
 * Settling writes history and posts the board immediately — even
 * with no console mounted — so a run is never lost to navigation.
 */
import { readBotNickname } from "./auth";
import type { Challenge, ChallengeGoals } from "./challenges";
import type { ChallengeAssets } from "./asset-schema";
import { SimRouteError, fetchSimCall, fetchSimCallStream } from "./direct-sim";
import type { FieldIntervention } from "./field-plan";
import { HISTORY_KEY, MAX_HISTORY_ENTRIES, loadHistory } from "./history";
import type { HistoryEntry } from "./history";
import { StreamError, readMatchStream } from "./match-stream";
import type { StreamTurn } from "./match-stream";
import { loadSealedText, sealText } from "./sealed-store";
import type { StorageLike } from "./sealed-store";
import { submitRun } from "./server-board";
import type { MatchResultPayload, TotePackResult } from "./sim";
import { bestVariantIndex } from "./variants";
import type { VariantRun, VariantSpec } from "./variants";

export type RunKind = "match" | "pack";
export type SessionStatus = "idle" | "running" | "done" | "error";

/** Live position inside a running match; null while idle. */
export interface RunProgressState {
  specIndex: number;
  specTotal: number;
  turn: number;
  total: number;
  startedAt: number;
}

/** Serializable slice of the armed challenge the sim echoes back. */
export interface RunChallengeParams {
  kind: "city" | "tote";
  id: string;
  seed: number;
  goals: ChallengeGoals;
}

/** Everything a match run needs, captured at click time. */
export interface MatchRunRequest {
  prompt: string;
  seed: number;
  model: string;
  uid: string;
  providerKey?: string;
  promptMaxWords?: number;
  tokenBudget?: number;
  interventions: FieldIntervention[];
  challengeParams?: RunChallengeParams;
  /** Challenge the run plays under; echoed as the result's challenge. */
  challenge: Challenge | undefined;
  specs: VariantSpec[];
  /** Contract turn count for the pre-stream progress readout. */
  turnsTotal: number;
  /** Stage dressing the run carries; echoed into history and the result. */
  assets: ChallengeAssets | null;
}

/** Everything a tote pack needs, captured at click time. */
export interface PackRunRequest {
  prompt: string;
  seed: number;
  model: string;
  uid: string;
  providerKey?: string;
}

export interface MatchSession {
  kind: "match";
  status: SessionStatus;
  /** Settled generation; mirrors the console runId. */
  token: number;
  /** Monotonic completion order across kinds; null until terminal. */
  completedSeq: number | null;
  /** Runs settle; replays present history without settling. */
  origin: "run" | "replay";
  progress: RunProgressState | null;
  result: MatchResultPayload | null;
  variants: VariantRun[] | null;
  resultAssets: ChallengeAssets | null;
  challenge: Challenge | undefined;
  error: string | null;
  boardPosition: number | null;
}

export interface PackSession {
  kind: "pack";
  status: SessionStatus;
  /** Settled generation; mirrors the console packId. */
  token: number;
  /** Monotonic completion order across kinds; null until terminal. */
  completedSeq: number | null;
  /** Runs settle; replays present history without settling. */
  origin: "run" | "replay";
  /** Epoch ms the pack started; null while idle. */
  startedAt: number | null;
  result: TotePackResult | null;
  error: string | null;
  boardPosition: number | null;
}

export interface RunStoreSnapshot {
  match: MatchSession;
  pack: PackSession;
  /** Bumped after history writes so lists reload. */
  historyBump: number;
  /** Acked completion sequence per kind; the toast owns these. */
  acked: Record<RunKind, number | null>;
}

/** Completion popup dwell: 7 seconds, then it closes itself. */
export const COMPLETION_TOAST_MS = 7000;

function idleMatch(): MatchSession {
  return {
    kind: "match",
    status: "idle",
    token: 0,
    completedSeq: null,
    origin: "run",
    progress: null,
    result: null,
    variants: null,
    resultAssets: null,
    challenge: undefined,
    error: null,
    boardPosition: null,
  };
}

function idlePack(): PackSession {
  return {
    kind: "pack",
    status: "idle",
    token: 0,
    completedSeq: null,
    origin: "run",
    startedAt: null,
    result: null,
    error: null,
    boardPosition: null,
  };
}

let snapshot: RunStoreSnapshot = {
  match: idleMatch(),
  pack: idlePack(),
  historyBump: 0,
  acked: { match: null, pack: null },
};
const listeners = new Set<() => void>();
let seqCounter = 0;
let matchToken = 0;
let packToken = 0;
let matchFlight: Promise<void> | null = null;
let packFlight: Promise<void> | null = null;

export function subscribeStore(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Current snapshot; the reference only changes on publish. */
export function getStoreSnapshot(): RunStoreSnapshot {
  return snapshot;
}

function publish(next: RunStoreSnapshot): void {
  snapshot = next;
  for (const listener of listeners) {
    listener();
  }
}

/** One completion the toast may show, newest sequence first. */
export interface PendingCompletion {
  kind: RunKind;
  seq: number;
  status: "done" | "error";
  title: string;
  detail: string;
}

function matchNotice(session: MatchSession): PendingCompletion | null {
  if (
    session.completedSeq === null ||
    (session.status !== "done" && session.status !== "error")
  ) {
    return null;
  }
  if (session.status === "error") {
    return {
      kind: "match",
      seq: session.completedSeq,
      status: "error",
      title: "Simulation failed",
      detail: session.error ?? "match failed",
    };
  }
  const impact = session.result?.scores.impact ?? 0;
  const efficiency = session.result?.scores.efficiency ?? 0;
  return {
    kind: "match",
    seq: session.completedSeq,
    status: "done",
    title: "Simulation complete",
    detail: `Impact ${String(impact)} · Efficiency ${String(efficiency)}`,
  };
}

function packNotice(session: PackSession): PendingCompletion | null {
  if (
    session.completedSeq === null ||
    (session.status !== "done" && session.status !== "error")
  ) {
    return null;
  }
  if (session.status === "error") {
    return {
      kind: "pack",
      seq: session.completedSeq,
      status: "error",
      title: "Tote pack failed",
      detail: session.error ?? "pack failed",
    };
  }
  return {
    kind: "pack",
    seq: session.completedSeq,
    status: "done",
    title: "Tote pack complete",
    detail: `Score ${String(session.result?.score ?? 0)}`,
  };
}

/**
 * Unacknowledged run completions, newest first. Replays never
 * notify (nothing settled); the toast additionally stays quiet on
 * the console route itself, where the verdict is already visible.
 */
export function pendingCompletions(state: RunStoreSnapshot): PendingCompletion[] {
  const found: PendingCompletion[] = [];
  const match = matchNotice(state.match);
  if (
    match !== null &&
    state.match.origin === "run" &&
    state.acked.match !== match.seq
  ) {
    found.push(match);
  }
  const pack = packNotice(state.pack);
  if (pack !== null && state.pack.origin === "run" && state.acked.pack !== pack.seq) {
    found.push(pack);
  }
  found.sort((a, b) => b.seq - a.seq);
  return found;
}

/** Ack one completion; stale sequences are ignored. */
export function ackCompletion(kind: RunKind, seq: number): void {
  const current =
    kind === "match" ? snapshot.match.completedSeq : snapshot.pack.completedSeq;
  if (current !== seq) {
    return;
  }
  publish({ ...snapshot, acked: { ...snapshot.acked, [kind]: seq } });
}

/**
 * Reset a settled session to idle (dismissing a verdict). A running
 * session is never touched — dismissal cannot cancel a live run.
 */
export function clearSession(kind: RunKind): void {
  if (kind === "match") {
    if (snapshot.match.status === "running") {
      return;
    }
    publish({
      ...snapshot,
      match: { ...idleMatch(), token: snapshot.match.token },
    });
    return;
  }
  if (snapshot.pack.status === "running") {
    return;
  }
  publish({
    ...snapshot,
    pack: { ...idlePack(), token: snapshot.pack.token },
  });
}

/** Present a history replay as the standing result; settles nothing. */
export function presentMatchReplay(
  result: MatchResultPayload,
  assets: ChallengeAssets | null,
): void {
  matchToken += 1;
  publish({
    ...snapshot,
    match: {
      ...idleMatch(),
      status: "done",
      token: matchToken,
      origin: "replay",
      result,
      resultAssets: assets,
    },
  });
}

/** Present a history pack replay as the standing result. */
export function presentPackReplay(result: TotePackResult): void {
  packToken += 1;
  publish({
    ...snapshot,
    pack: {
      ...idlePack(),
      status: "done",
      token: packToken,
      origin: "replay",
      result,
    },
  });
}

function runStorage(): StorageLike | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

/** Prepend settled entries to the sealed history, capped like the console. */
async function persistHistoryEntries(
  uid: string,
  entries: HistoryEntry[],
): Promise<void> {
  const storage = runStorage();
  if (storage === null) {
    return;
  }
  const read = await loadSealedText(storage, HISTORY_KEY, uid);
  const next = [...entries, ...loadHistory(read.text)].slice(0, MAX_HISTORY_ENTRIES);
  await sealText(storage, HISTORY_KEY, uid, JSON.stringify(next));
}

/** Attach a live-board receipt to one persisted entry. */
async function attachHistoryReceipt(
  uid: string,
  when: string,
  position: number,
): Promise<void> {
  const storage = runStorage();
  if (storage === null) {
    return;
  }
  const read = await loadSealedText(storage, HISTORY_KEY, uid);
  const next = loadHistory(read.text).map((item) =>
    item.when === when ? { ...item, boardPosition: position } : item,
  );
  await sealText(storage, HISTORY_KEY, uid, JSON.stringify(next));
}

function matchBodies(
  request: MatchRunRequest,
  spec: VariantSpec,
): {
  proxy: string;
  direct: string;
} {
  const limits: { promptMaxWords?: number; tokenBudget?: number } = {
    ...(request.promptMaxWords === undefined
      ? {}
      : { promptMaxWords: request.promptMaxWords }),
    ...(request.tokenBudget === undefined ? {} : { tokenBudget: request.tokenBudget }),
  };
  return {
    proxy: JSON.stringify({
      prompt: request.prompt,
      seed: spec.seed,
      model: request.model,
      uid: request.uid,
      providerKey: request.providerKey,
      ...limits,
      ...(request.interventions.length === 0
        ? {}
        : { interventions: request.interventions }),
      ...(request.challengeParams === undefined
        ? {}
        : { challenge_params: request.challengeParams }),
      ...(spec.chaosLevel === undefined ? {} : { chaosLevel: spec.chaosLevel }),
    }),
    direct: JSON.stringify({
      prompt: request.prompt,
      seed: spec.seed,
      model: request.model,
      uid: request.uid,
      ...(request.promptMaxWords === undefined
        ? {}
        : { prompt_max_words: request.promptMaxWords }),
      ...(request.tokenBudget === undefined
        ? {}
        : { token_budget: request.tokenBudget }),
      ...(request.interventions.length === 0
        ? {}
        : { interventions: request.interventions }),
      ...(request.challengeParams === undefined
        ? {}
        : { challenge_params: request.challengeParams }),
      ...(spec.chaosLevel === undefined ? {} : { chaos_level: spec.chaosLevel }),
    }),
  };
}

function publishMatchError(message: string): void {
  seqCounter += 1;
  publish({
    ...snapshot,
    match: {
      ...snapshot.match,
      status: "error",
      completedSeq: seqCounter,
      origin: "run",
      progress: null,
      error: message,
    },
  });
}

function matchErrorDetail(body: unknown, fallback: string): string {
  const detail =
    typeof body === "object" && body !== null
      ? (body as Record<string, unknown>).error
      : undefined;
  return typeof detail === "string" ? detail : fallback;
}

async function playMatchStream(
  request: MatchRunRequest,
  spec: VariantSpec,
  specIndex: number,
  specTotal: number,
  startedAt: number,
  directHeaders: Record<string, string>,
): Promise<MatchResultPayload | null | "fallback"> {
  const bodies = matchBodies(request, spec);
  const response = await fetchSimCallStream(
    {
      path: "/api/match-stream",
      init: {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: bodies.proxy,
      },
    },
    {
      path: "/matches/stream",
      model: request.model,
      init: {
        method: "POST",
        headers: directHeaders,
        body: bodies.direct,
      },
    },
  );
  if (response.status === 404) {
    return "fallback";
  }
  if (!response.ok) {
    const body: unknown = await response.json().catch(() => null);
    publishMatchError(matchErrorDetail(body, "match failed"));
    return null;
  }
  try {
    return await readMatchStream(response, (turn: StreamTurn) => {
      publish({
        ...snapshot,
        match: {
          ...snapshot.match,
          progress: {
            specIndex,
            specTotal,
            turn: turn.turn,
            total: turn.total,
            startedAt,
          },
        },
      });
    });
  } catch (error) {
    const message =
      error instanceof StreamError ? error.message : "match stream failed";
    publishMatchError(
      message === "provider_failed"
        ? "The model failed mid-match — retry to replay the seed."
        : message,
    );
    return null;
  }
}

async function playOneMatch(
  request: MatchRunRequest,
  spec: VariantSpec,
  specIndex: number,
  specTotal: number,
  startedAt: number,
  directHeaders: Record<string, string>,
): Promise<MatchResultPayload | null> {
  // Stream first: turns report live. A 404 means an older sim
  // without the stream endpoint — fall through to blocking.
  const streamed = await playMatchStream(
    request,
    spec,
    specIndex,
    specTotal,
    startedAt,
    directHeaders,
  );
  if (streamed !== "fallback") {
    return streamed;
  }
  const bodies = matchBodies(request, spec);
  const response = await fetchSimCall(
    {
      path: "/api/match",
      init: {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: bodies.proxy,
      },
    },
    {
      path: "/matches/run",
      model: request.model,
      init: {
        method: "POST",
        headers: directHeaders,
        body: bodies.direct,
      },
    },
  );
  const body: unknown = await response.json();
  if (!response.ok) {
    publishMatchError(matchErrorDetail(body, "match failed"));
    return null;
  }
  return body as MatchResultPayload;
}

/**
 * One settle for every path: the best run by impact becomes the
 * result, every variant lands in history with its own timestamp,
 * the board takes the best.
 */
async function settleMatch(
  request: MatchRunRequest,
  specs: VariantSpec[],
  payloads: MatchResultPayload[],
): Promise<void> {
  const at = bestVariantIndex(payloads);
  const payload = payloads[at];
  if (payload === undefined) {
    publishMatchError("match failed");
    return;
  }
  matchToken += 1;
  seqCounter += 1;
  const token = matchToken;
  const seq = seqCounter;
  const nickname = readBotNickname();
  const baseMs = Date.now();
  const bestWhen = new Date(baseMs + at).toISOString();
  const entries: HistoryEntry[] = payloads.map((entry, index) => ({
    when: new Date(baseMs + index).toISOString(),
    seed: entry.seed,
    provider: entry.provider,
    game: "city",
    impact: entry.scores.impact ?? 0,
    efficiency: entry.scores.efficiency ?? 0,
    prompt: request.prompt,
    uid: request.uid,
    result: entry,
    model: request.model,
    ...(request.interventions.length === 0 ? {} : { plan: [...request.interventions] }),
    ...(request.assets === null ? {} : { assets: request.assets }),
  }));
  await persistHistoryEntries(request.uid, entries);
  publish({
    ...snapshot,
    match: {
      kind: "match",
      status: "done",
      token,
      completedSeq: seq,
      origin: "run",
      progress: null,
      result: payload,
      variants:
        payloads.length === 1
          ? null
          : payloads.map((entry, index) => ({
              label: specs[index]?.label ?? `Variant ${String(index + 1)}`,
              result: entry,
            })),
      resultAssets: request.assets,
      challenge: request.challenge,
      error: null,
      boardPosition: null,
    },
    historyBump: snapshot.historyBump + 1,
  });
  void submitRun({
    uid: request.uid,
    game: "city",
    ...(request.challenge === undefined ? {} : { challenge: request.challenge.id }),
    seed: payload.seed,
    model: request.model,
    provider: payload.provider,
    ...(nickname === null ? {} : { nickname }),
    badges: payload.badges,
    strategy: payload.strategy,
    impact: payload.scores.impact ?? 0,
    efficiency: payload.scores.efficiency ?? 0,
    ...(payload.receipt === undefined ? {} : { receipt: payload.receipt }),
  }).then((receipt) => {
    if (receipt === null) {
      return;
    }
    // A newer run may have started since: only the run that earned
    // the receipt may adopt its board position.
    if (getStoreSnapshot().match.token !== token) {
      return;
    }
    void attachHistoryReceipt(request.uid, bestWhen, receipt.position).then(() => {
      if (getStoreSnapshot().match.token !== token) {
        return;
      }
      publish({
        ...snapshot,
        match: { ...snapshot.match, boardPosition: receipt.position },
        historyBump: snapshot.historyBump + 1,
      });
    });
  });
}

async function executeMatch(request: MatchRunRequest): Promise<void> {
  publish({
    ...snapshot,
    match: {
      ...idleMatch(),
      status: "running",
      token: snapshot.match.token,
    },
  });
  const directHeaders: Record<string, string> = {
    "content-type": "application/json",
  };
  if (request.providerKey !== undefined) {
    directHeaders["x-provider-key"] = request.providerKey;
  }
  try {
    const startedAt = Date.now();
    const payloads: MatchResultPayload[] = [];
    for (const [index, spec] of request.specs.entries()) {
      publish({
        ...snapshot,
        match: {
          ...snapshot.match,
          progress: {
            specIndex: index,
            specTotal: request.specs.length,
            turn: 0,
            total: request.turnsTotal,
            startedAt,
          },
        },
      });
      const payload = await playOneMatch(
        request,
        spec,
        index,
        request.specs.length,
        startedAt,
        directHeaders,
      );
      if (payload === null) {
        return;
      }
      payloads.push(payload);
    }
    await settleMatch(request, request.specs, payloads);
  } catch (error) {
    publishMatchError(
      error instanceof SimRouteError
        ? error.message
        : "Web server lost contact with the sim API mid-match.",
    );
  }
}

/**
 * Run one match in the background; concurrent callers join the live
 * run. Never rejects — failures publish an error session instead.
 */
export function startMatchRun(request: MatchRunRequest): Promise<void> {
  if (matchFlight !== null) {
    return matchFlight;
  }
  matchFlight = executeMatch(request).finally(() => {
    matchFlight = null;
  });
  return matchFlight;
}

function publishPackError(message: string): void {
  seqCounter += 1;
  publish({
    ...snapshot,
    pack: {
      ...snapshot.pack,
      status: "error",
      completedSeq: seqCounter,
      origin: "run",
      startedAt: null,
      error: message,
    },
  });
}

async function executePack(request: PackRunRequest): Promise<void> {
  const startedAt = Date.now();
  publish({
    ...snapshot,
    pack: {
      ...idlePack(),
      status: "running",
      token: snapshot.pack.token,
      startedAt,
    },
  });
  const directHeaders: Record<string, string> = {
    "content-type": "application/json",
  };
  if (request.providerKey !== undefined) {
    directHeaders["x-provider-key"] = request.providerKey;
  }
  try {
    const response = await fetchSimCall(
      {
        path: "/api/tote",
        init: {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            prompt: request.prompt,
            seed: request.seed,
            model: request.model,
            uid: request.uid,
            providerKey: request.providerKey,
          }),
        },
      },
      {
        path: "/tote/pack",
        model: request.model,
        init: {
          method: "POST",
          headers: directHeaders,
          body: JSON.stringify({
            prompt: request.prompt,
            seed: request.seed,
            model: request.model,
            uid: request.uid,
          }),
        },
      },
    );
    const body: unknown = await response.json();
    if (!response.ok) {
      publishPackError(matchErrorDetail(body, "pack failed"));
      return;
    }
    const payload = body as TotePackResult;
    packToken += 1;
    seqCounter += 1;
    const token = packToken;
    const seq = seqCounter;
    const nickname = readBotNickname();
    const when = new Date().toISOString();
    await persistHistoryEntries(request.uid, [
      {
        when,
        seed: payload.seed,
        provider: payload.provider,
        game: "tote",
        score: payload.score,
        damage: payload.damage.total,
        packed: payload.packing.length,
        prompt: request.prompt,
        uid: request.uid,
        result: payload,
        model: request.model,
      },
    ]);
    publish({
      ...snapshot,
      pack: {
        kind: "pack",
        status: "done",
        token,
        completedSeq: seq,
        origin: "run",
        startedAt: null,
        result: payload,
        error: null,
        boardPosition: null,
      },
      historyBump: snapshot.historyBump + 1,
    });
    void submitRun({
      uid: request.uid,
      game: "tote",
      seed: payload.seed,
      model: request.model,
      provider: payload.provider,
      ...(nickname === null ? {} : { nickname }),
      badges: payload.badges,
      score: payload.score,
      ...(payload.receipt === undefined ? {} : { receipt: payload.receipt }),
    }).then((receipt) => {
      if (receipt === null) {
        return;
      }
      if (getStoreSnapshot().pack.token !== token) {
        return;
      }
      void attachHistoryReceipt(request.uid, when, receipt.position).then(() => {
        if (getStoreSnapshot().pack.token !== token) {
          return;
        }
        publish({
          ...snapshot,
          pack: { ...snapshot.pack, boardPosition: receipt.position },
          historyBump: snapshot.historyBump + 1,
        });
      });
    });
  } catch (error) {
    publishPackError(
      error instanceof SimRouteError
        ? error.message
        : "Web server lost contact with the sim API mid-pack.",
    );
  }
}

/**
 * Run one tote pack in the background; concurrent callers join the
 * live pack. Never rejects — failures publish an error session.
 */
export function startPackRun(request: PackRunRequest): Promise<void> {
  if (packFlight !== null) {
    return packFlight;
  }
  packFlight = executePack(request).finally(() => {
    packFlight = null;
  });
  return packFlight;
}
