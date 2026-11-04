/**
 * Local-first social layer: share codes, browser leagues, seasons, and
 * device-local Elo. Everything here is computed and stored on this
 * machine — codes travel by copy-paste over any channel, and nothing in
 * this module talks to a server or carries a provider key.
 */
import { parseChallengeAssets } from "./asset-schema";
import { normalizeBotNickname } from "./auth";
import type { Challenge } from "./challenges";
import { entryGame } from "./history";
import type { HistoryEntry } from "./history";
import { b64decode, b64encode, isValidUid } from "./vault";

export const SHARE_PREFIX = "AIM1.";
export const LEAGUES_KEY = "aim-arena-leagues";
export const GHOSTS_KEY = "aim-arena-ghosts";
export const RATINGS_KEY = "aim-arena-ratings";
export const LEAGUE_NAME_MAX = 40;
export const ELO_START = 1200;
export const ELO_K = 24;
export const SEASON_DAYS = 14;
export const SEASON_ANCHOR = "2026-01-05T00:00:00.000Z";

const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_MEMBERS = 32;
const MAX_PROMPT_CHARS = 5000;

export type SocialGame = "city" | "tote";

export interface LeagueMember {
  uid: string;
  nickname: string | null;
}

export interface League {
  id: string;
  name: string;
  createdAt: string;
  members: LeagueMember[];
}

export interface DuelShare {
  version: 1;
  kind: "duel";
  game: SocialGame;
  seed: number;
  challenge: string | null;
  model: string;
  nickname: string | null;
  uid: string;
  value: number;
  metric: "impact" | "score";
  prompt?: string;
  when: string;
}

export interface LeagueShare {
  version: 1;
  kind: "league";
  league: League;
}

/**
 * A playable copy of one created challenge: everything the rotation
 * builder needs (seed derives from the proposal id), plus the
 * contract text for context. Field caps mirror the creator form's.
 */
export interface TrialSnapshot {
  proposalId: number;
  title: string;
  description: string;
  model: string;
  inputPrompt: string;
  outputFormat: string;
  restrictions: string | null;
  /** Raw dressing params; parsed again before play. */
  assets?: unknown;
  ownerUid: string;
  ownerNickname: string | null;
}

export interface TrialShare {
  version: 1;
  kind: "trial";
  trial: TrialSnapshot;
}

export type SharePayload = DuelShare | LeagueShare | TrialShare;

export type GhostOutcome = "pending" | "won" | "lost" | "tied";

export interface Ghost {
  id: string;
  uid: string;
  nickname: string | null;
  game: SocialGame;
  seed: number;
  challenge: string | null;
  model: string;
  value: number;
  metric: "impact" | "score";
  prompt: string | null;
  when: string;
  importedAt: string;
  outcome: GhostOutcome;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function cleanNickname(value: unknown): string | null {
  return typeof value === "string" ? normalizeBotNickname(value) : null;
}

function isMember(value: unknown): value is LeagueMember {
  return (
    isRecord(value) &&
    isValidUid(value.uid) &&
    (value.nickname === null ||
      value.nickname === undefined ||
      typeof value.nickname === "string")
  );
}

function cleanMember(value: LeagueMember): LeagueMember {
  return { uid: value.uid, nickname: cleanNickname(value.nickname) };
}

function isLeague(value: unknown): value is League {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    value.id.length >= 1 &&
    value.id.length <= 64 &&
    typeof value.name === "string" &&
    value.name.trim() !== "" &&
    typeof value.createdAt === "string" &&
    Array.isArray(value.members) &&
    value.members.length <= MAX_MEMBERS &&
    value.members.every(isMember)
  );
}

function cleanLeague(value: League): League {
  const seen = new Set<string>();
  const members: LeagueMember[] = [];
  for (const member of value.members) {
    if (!seen.has(member.uid)) {
      seen.add(member.uid);
      members.push(cleanMember(member));
    }
  }
  return {
    id: value.id,
    name: value.name.trim().slice(0, LEAGUE_NAME_MAX),
    createdAt: value.createdAt,
    members,
  };
}

function isDuel(value: unknown): value is DuelShare {
  if (!isRecord(value) || value.version !== 1 || value.kind !== "duel") {
    return false;
  }
  const gameOk = value.game === "city" || value.game === "tote";
  const metricOk =
    (value.game === "city" && value.metric === "impact") ||
    (value.game === "tote" && value.metric === "score");
  return (
    gameOk &&
    metricOk &&
    typeof value.seed === "number" &&
    Number.isInteger(value.seed) &&
    (value.challenge === null ||
      (typeof value.challenge === "string" && value.challenge.length <= 64)) &&
    typeof value.model === "string" &&
    value.model !== "" &&
    isValidUid(value.uid) &&
    (value.nickname === null ||
      value.nickname === undefined ||
      typeof value.nickname === "string") &&
    typeof value.value === "number" &&
    Number.isFinite(value.value) &&
    typeof value.when === "string" &&
    (value.prompt === undefined ||
      (typeof value.prompt === "string" && value.prompt.length <= MAX_PROMPT_CHARS))
  );
}

/** Encode a share payload as a copy-paste code. Keys are never included. */
export function encodeShareCode(payload: SharePayload): string {
  return SHARE_PREFIX + b64encode(new TextEncoder().encode(JSON.stringify(payload)));
}

function cleanDuel(value: DuelShare): DuelShare {
  const duel: DuelShare = {
    version: 1,
    kind: "duel",
    game: value.game,
    seed: value.seed,
    challenge: typeof value.challenge === "string" ? value.challenge : null,
    model: value.model,
    nickname: cleanNickname(value.nickname),
    uid: value.uid,
    value: value.value,
    metric: value.metric,
    when: value.when,
  };
  if (typeof value.prompt === "string" && value.prompt !== "") {
    duel.prompt = value.prompt;
  }
  return duel;
}

/** Parse a share code; null when malformed, versioned wrong, or untrusted. */
export function decodeShareCode(raw: string): SharePayload | null {
  const trimmed = raw.trim();
  if (!trimmed.startsWith(SHARE_PREFIX)) {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(
      new TextDecoder().decode(b64decode(trimmed.slice(SHARE_PREFIX.length))),
    );
  } catch {
    return null;
  }
  if (!isRecord(parsed) || parsed.version !== 1) {
    return null;
  }
  if (parsed.kind === "duel") {
    return isDuel(parsed) ? cleanDuel(parsed) : null;
  }
  if (parsed.kind === "league") {
    return isLeague(parsed.league)
      ? { version: 1, kind: "league", league: cleanLeague(parsed.league) }
      : null;
  }
  if (parsed.kind === "trial") {
    return isTrial(parsed.trial)
      ? { version: 1, kind: "trial", trial: cleanTrial(parsed.trial) }
      : null;
  }
  return null;
}

const TRIAL_TITLE_MAX = 80;
const TRIAL_TEXT_MAX = 2000;
const TRIAL_MODEL_MAX = 64;
const TRIAL_FORMAT_MAX = 255;

function isTrial(value: unknown): value is TrialSnapshot {
  if (!isRecord(value)) {
    return false;
  }
  const assets = value.assets;
  return (
    typeof value.proposalId === "number" &&
    Number.isInteger(value.proposalId) &&
    value.proposalId > 0 &&
    typeof value.title === "string" &&
    value.title.trim() !== "" &&
    value.title.length <= TRIAL_TITLE_MAX &&
    typeof value.description === "string" &&
    value.description.length <= TRIAL_TEXT_MAX &&
    typeof value.model === "string" &&
    value.model.length <= TRIAL_MODEL_MAX &&
    typeof value.inputPrompt === "string" &&
    value.inputPrompt.length <= TRIAL_TEXT_MAX &&
    typeof value.outputFormat === "string" &&
    value.outputFormat.length <= TRIAL_FORMAT_MAX &&
    (value.restrictions === null ||
      value.restrictions === undefined ||
      (typeof value.restrictions === "string" &&
        value.restrictions.length <= TRIAL_TEXT_MAX)) &&
    (assets === undefined || assets === null || isRecord(assets)) &&
    isValidUid(value.ownerUid) &&
    (value.ownerNickname === null ||
      value.ownerNickname === undefined ||
      typeof value.ownerNickname === "string")
  );
}

function cleanTrial(value: TrialSnapshot): TrialSnapshot {
  const trial: TrialSnapshot = {
    proposalId: value.proposalId,
    title: value.title.trim(),
    description: value.description,
    model: value.model,
    inputPrompt: value.inputPrompt,
    outputFormat: value.outputFormat,
    restrictions:
      typeof value.restrictions === "string" && value.restrictions !== ""
        ? value.restrictions
        : null,
    ownerUid: value.ownerUid,
    ownerNickname: cleanNickname(value.ownerNickname),
  };
  if (value.assets !== undefined && value.assets !== null) {
    trial.assets = value.assets;
  }
  return trial;
}

/**
 * Snapshot a board proposal for play/sharing. Structural on purpose:
 * the community module stays free of league imports.
 */
export function snapshotFromProposal(proposal: {
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
}): TrialSnapshot {
  const snapshot: TrialSnapshot = {
    proposalId: proposal.id,
    title: proposal.title,
    description: proposal.description,
    model: proposal.model,
    inputPrompt: proposal.input_prompt,
    outputFormat: proposal.output_format,
    restrictions: proposal.restrictions,
    ownerUid: proposal.uid,
    ownerNickname: proposal.nickname,
  };
  if (proposal.assets !== undefined && proposal.assets !== null) {
    snapshot.assets = proposal.assets;
  }
  return snapshot;
}

/** The playable rotation trial behind a stored/shared snapshot. */
export function trialChallenge(snapshot: TrialSnapshot): Challenge {
  return rotationChallenge({
    id: snapshot.proposalId,
    title: snapshot.title,
    description: snapshot.description,
    assets: snapshot.assets,
  });
}

export const TRIALS_KEY = "aim-arena-trials";
const MAX_TRIALS = 32;

/** Stored trial snapshots, newest kept; corrupt reads as empty. */
export function loadTrials(raw: string | null): TrialSnapshot[] {
  if (raw === null) {
    return [];
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }
    const seen = new Set<number>();
    const trials: TrialSnapshot[] = [];
    for (const entry of parsed) {
      if (!isTrial(entry) || seen.has(entry.proposalId)) {
        continue;
      }
      seen.add(entry.proposalId);
      trials.push(cleanTrial(entry));
      if (trials.length >= MAX_TRIALS) {
        break;
      }
    }
    return trials;
  } catch {
    return [];
  }
}

/** Store or refresh one imported trial; returns the next list. */
export function upsertTrial(
  trials: TrialSnapshot[],
  incoming: TrialSnapshot,
): TrialSnapshot[] {
  const clean = cleanTrial(incoming);
  return [
    clean,
    ...trials.filter((entry) => entry.proposalId !== clean.proposalId),
  ].slice(0, MAX_TRIALS);
}

/**
 * Duel target from a finished run. The prompt travels only when the
 * owner opts in; the default code is a score to beat, nothing more.
 */
export function duelFromEntry(
  entry: HistoryEntry,
  options: { nickname: string | null; includePrompt?: boolean },
): DuelShare | null {
  const game = entryGame(entry);
  const value = game === "tote" ? entry.score : entry.impact;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }
  const uid = entry.uid;
  if (!isValidUid(uid)) {
    return null;
  }
  const duel: DuelShare = {
    version: 1,
    kind: "duel",
    game,
    seed: entry.seed,
    challenge: null,
    model: entry.model ?? entry.provider,
    nickname: cleanNickname(options.nickname),
    uid,
    value,
    metric: game === "tote" ? "score" : "impact",
    when: entry.when,
  };
  if (options.includePrompt === true && entry.prompt !== "") {
    duel.prompt = entry.prompt;
  }
  return duel;
}

/** Store an imported duel as a local ghost rival. */
export function ghostFromDuel(duel: DuelShare, importedAt: string): Ghost {
  return {
    id: `${duel.uid}|${duel.game}|${String(duel.seed)}|${duel.when}`,
    uid: duel.uid,
    nickname: duel.nickname,
    game: duel.game,
    seed: duel.seed,
    challenge: duel.challenge,
    model: duel.model,
    value: duel.value,
    metric: duel.metric,
    prompt: duel.prompt ?? null,
    when: duel.when,
    importedAt,
    outcome: "pending",
  };
}

function slugify(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug === "" ? "league" : slug;
}

/** Create a league with the creator as its first member; null on bad input. */
export function createLeague(
  name: string,
  uid: string,
  nickname: string | null,
  now: string,
  suffix: string,
): League | null {
  const clean = name.trim().slice(0, LEAGUE_NAME_MAX);
  if (clean === "" || !isValidUid(uid)) {
    return null;
  }
  const tail = suffix
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "")
    .slice(0, 8);
  return {
    id: `${slugify(clean)}-${tail === "" ? "local" : tail}`,
    name: clean,
    createdAt: now,
    members: [{ uid, nickname: cleanNickname(nickname) }],
  };
}

/**
 * Join or refresh a league from an invite: members union by arena ID,
 * and the importer joins when they are not already a member.
 */
export function mergeLeague(
  local: League[],
  incoming: League,
  self?: LeagueMember,
): League[] {
  if (!isLeague(incoming)) {
    return local;
  }
  const clean = cleanLeague(incoming);
  if (
    self !== undefined &&
    isMember(self) &&
    !clean.members.some((m) => m.uid === self.uid)
  ) {
    clean.members.push(cleanMember(self));
  }
  const existing = local.find((league) => league.id === clean.id);
  if (existing === undefined) {
    return [...local, clean];
  }
  const merged: League = {
    ...existing,
    members: [...existing.members],
  };
  for (const member of clean.members) {
    if (!merged.members.some((entry) => entry.uid === member.uid)) {
      merged.members.push(member);
    }
  }
  return local.map((league) => (league.id === clean.id ? merged : league));
}

/** Local leagues; corrupt or missing storage reads as empty. */
export function loadLeagues(raw: string | null): League[] {
  if (raw === null) {
    return [];
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.filter(isLeague).map(cleanLeague);
  } catch {
    return [];
  }
}

const OUTCOMES: readonly string[] = ["pending", "won", "lost", "tied"];

function isGhost(value: unknown): value is Ghost {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    isValidUid(value.uid) &&
    (value.game === "city" || value.game === "tote") &&
    typeof value.seed === "number" &&
    typeof value.model === "string" &&
    typeof value.value === "number" &&
    Number.isFinite(value.value) &&
    typeof value.when === "string" &&
    typeof value.importedAt === "string"
  );
}

function cleanGhost(value: Ghost): Ghost {
  return {
    ...value,
    nickname: cleanNickname(value.nickname),
    challenge: typeof value.challenge === "string" ? value.challenge : null,
    metric: value.game === "tote" ? "score" : "impact",
    prompt: typeof value.prompt === "string" ? value.prompt : null,
    outcome: OUTCOMES.includes(value.outcome) ? value.outcome : "pending",
  };
}

/** Imported ghosts; corrupt or missing storage reads as empty. */
export function loadGhosts(raw: string | null): Ghost[] {
  if (raw === null) {
    return [];
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.filter(isGhost).map(cleanGhost);
  } catch {
    return [];
  }
}

/** Device-local Elo ratings by arena ID; bad rows are dropped. */
export function loadRatings(raw: string | null): Record<string, number> {
  if (raw === null) {
    return {};
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed)) {
      return {};
    }
    const out: Record<string, number> = {};
    for (const [uid, value] of Object.entries(parsed)) {
      if (isValidUid(uid) && typeof value === "number" && Number.isFinite(value)) {
        out[uid] = value;
      }
    }
    return out;
  } catch {
    return {};
  }
}

export interface StandingEntry {
  uid: string;
  nickname: string | null;
  value: number;
  when: string;
}

export interface StandingRow {
  uid: string;
  nickname: string | null;
  best: number;
  plays: number;
  bestWhen: string;
}

/** Standing row for one of your own runs; null when it has no score. */
export function entryStanding(
  entry: HistoryEntry,
  ownUid: string,
  ownNickname: string | null,
): StandingEntry | null {
  const value = entryGame(entry) === "tote" ? entry.score : entry.impact;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }
  const uid = isValidUid(entry.uid) ? entry.uid : ownUid;
  return {
    uid,
    nickname: uid === ownUid ? cleanNickname(ownNickname) : null,
    value,
    when: entry.when,
  };
}

/** Standing row for an imported ghost target. */
export function ghostStanding(ghost: Ghost): StandingEntry {
  return {
    uid: ghost.uid,
    nickname: ghost.nickname,
    value: ghost.value,
    when: ghost.when,
  };
}

/**
 * Best-per-member standings. Sort mirrors the board: best value first,
 * earliest run achieving that best wins a tie.
 */
export function standingsFor(
  rows: StandingEntry[],
  memberUids?: string[],
): StandingRow[] {
  const members = memberUids === undefined ? null : new Set(memberUids);
  const byUid = new Map<string, StandingRow>();
  for (const row of rows) {
    if (members !== null && !members.has(row.uid)) {
      continue;
    }
    const current = byUid.get(row.uid);
    if (current === undefined) {
      byUid.set(row.uid, {
        uid: row.uid,
        nickname: row.nickname,
        best: row.value,
        plays: 1,
        bestWhen: row.when,
      });
      continue;
    }
    current.plays += 1;
    if (current.nickname === null && row.nickname !== null) {
      current.nickname = row.nickname;
    }
    if (
      row.value > current.best ||
      (row.value === current.best && row.when < current.bestWhen)
    ) {
      current.best = row.value;
      current.bestWhen = row.when;
    }
  }
  return [...byUid.values()].sort((a, b) => {
    if (a.best !== b.best) {
      return b.best - a.best;
    }
    if (a.bestWhen !== b.bestWhen) {
      return a.bestWhen < b.bestWhen ? -1 : 1;
    }
    return a.uid < b.uid ? -1 : 1;
  });
}

export interface Season {
  index: number;
  id: string;
  label: string;
  startsAt: string;
  endsAt: string;
}

/** Fixed 14-day season containing a date; windows are UTC, end-exclusive. */
export function seasonFor(date: Date): Season {
  const anchor = Date.parse(SEASON_ANCHOR);
  const index = Math.floor((date.getTime() - anchor) / (SEASON_DAYS * DAY_MS));
  const start = anchor + index * SEASON_DAYS * DAY_MS;
  const startsAt = new Date(start).toISOString();
  const endsAt = new Date(start + SEASON_DAYS * DAY_MS).toISOString();
  return {
    index,
    id: `S${String(index + 1)}`,
    label: `Season ${String(index + 1)} · ${startsAt.slice(0, 10)} to ${endsAt.slice(0, 10)}`,
    startsAt,
    endsAt,
  };
}

/** True when a timestamp falls inside the season window. */
export function inSeason(when: string, season: Season): boolean {
  const at = Date.parse(when);
  if (Number.isNaN(at)) {
    return false;
  }
  return at >= Date.parse(season.startsAt) && at < Date.parse(season.endsAt);
}

/** Win expectancy for a rated player against an opponent. */
export function expectedScore(rating: number, opponent: number): number {
  return 1 / (1 + 10 ** ((opponent - rating) / 400));
}

function settledRating(rating: number, opponent: number, score: number): number {
  return Math.round(rating + ELO_K * (score - expectedScore(rating, opponent)));
}

/** Zero-sum Elo update for a decisive duel. */
export function updateElo(
  winnerRating: number,
  loserRating: number,
): { winner: number; loser: number } {
  return {
    winner: settledRating(winnerRating, loserRating, 1),
    loser: settledRating(loserRating, winnerRating, 0),
  };
}

/** Rating for an arena ID; unrated ids start at the floor. */
export function ratingFor(ratings: Record<string, number>, uid: string): number {
  return ratings[uid] ?? ELO_START;
}

export interface DuelResolution {
  ghosts: Ghost[];
  ratings: Record<string, number>;
  settled: Ghost[];
}

/**
 * Settle pending ghosts against your best run on the same shift + seed.
 * Each ghost settles once; rescanning settled ghosts changes nothing.
 */
export function resolveDuels(
  history: HistoryEntry[],
  ghosts: Ghost[],
  ratings: Record<string, number>,
  ownUid: string,
): DuelResolution {
  const bestBySeed = new Map<string, number>();
  for (const entry of history) {
    const standing = entryStanding(entry, ownUid, null);
    if (standing === null) {
      continue;
    }
    const key = `${entryGame(entry)}|${String(entry.seed)}`;
    const current = bestBySeed.get(key);
    if (current === undefined || standing.value > current) {
      bestBySeed.set(key, standing.value);
    }
  }
  const nextRatings: Record<string, number> = { ...ratings };
  const settled: Ghost[] = [];
  const nextGhosts = ghosts.map((ghost) => {
    if (ghost.outcome !== "pending") {
      return ghost;
    }
    const mine = bestBySeed.get(`${ghost.game}|${String(ghost.seed)}`);
    if (mine === undefined) {
      return ghost;
    }
    const outcome: GhostOutcome =
      mine > ghost.value ? "won" : mine < ghost.value ? "lost" : "tied";
    const myScore = outcome === "won" ? 1 : outcome === "lost" ? 0 : 0.5;
    const myRating = ratingFor(nextRatings, ownUid);
    const ghostRating = ratingFor(nextRatings, ghost.uid);
    nextRatings[ownUid] = settledRating(myRating, ghostRating, myScore);
    nextRatings[ghost.uid] = settledRating(ghostRating, myRating, 1 - myScore);
    const done: Ghost = { ...ghost, outcome };
    settled.push(done);
    return done;
  });
  return { ghosts: nextGhosts, ratings: nextRatings, settled };
}

const ROTATION_WORDS = 200;
const ROTATION_TOKEN_BUDGET = 12000;

/** Proposal id inside a rotation challenge id, or null for chain challenges. */
export function parseRotationId(challengeId: string): number | null {
  const match = /^rotation-(\d+)$/.exec(challengeId);
  if (match?.[1] === undefined) {
    return null;
  }
  const id = Number.parseInt(match[1], 10);
  return Number.isInteger(id) ? id : null;
}

function rotationSeed(proposalId: number): number {
  let hash = 5381;
  const text = `rotation-${String(proposalId)}`;
  for (let index = 0; index < text.length; index += 1) {
    hash = ((hash * 33) ^ text.charCodeAt(index)) >>> 0;
  }
  return 1000 + (hash % 9000);
}

/**
 * Playable trial for a featured community proposal. The seed derives
 * deterministically from the proposal id, goals stay finish-only, and
 * the board scope (`rotation-<id>`) keeps rotation runs out of the
 * ranked trial chain.
 */
export function rotationChallenge(proposal: {
  id: number;
  title: string;
  description: string;
  assets?: unknown;
}): Challenge {
  const title =
    proposal.title.trim() === "" ? "Community trial" : proposal.title.trim();
  const description =
    proposal.description.trim() === "" ? title : proposal.description.trim();
  const parsed = parseChallengeAssets(proposal.assets);
  return {
    kind: "city",
    id: `rotation-${String(proposal.id)}`,
    title,
    brief: description,
    seed: rotationSeed(proposal.id),
    tip: "Community rotation trial — any valid run clears it; the rotation board keeps its own scope.",
    goals: { minImpact: 0 },
    drivers: ["community rotation"],
    words: ROTATION_WORDS,
    tokenBudget: ROTATION_TOKEN_BUDGET,
    story: [
      description,
      "A community trial joins the rotation: one simulation, no chain locks.",
      `Clear “${title}” — finish the match to take the trial.`,
    ],
    assets: parsed.ok ? parsed.value : null,
  };
}

/** Reserved rotation id for unproposed local drafts (proposals start at 1). */
const LOCAL_TRIAL_PROPOSAL_ID = 0;

/**
 * Playable trial for an unproposed creator draft: the rotation
 * shape (derived seed, rotation limits, finish-only goals) under a
 * reserved local id, so it skips clears and chain effects exactly
 * like a rotation trial. Title, description, and dressing are the
 * whole playable surface — proposal metadata stays on the form.
 */
export function localTrialChallenge(draft: {
  title: string;
  description: string;
  assets?: unknown;
}): Challenge {
  const title = draft.title.trim() === "" ? "Local draft" : draft.title.trim();
  const description =
    draft.description.trim() === "" ? title : draft.description.trim();
  const parsed = parseChallengeAssets(draft.assets);
  return {
    kind: "city",
    id: `rotation-${String(LOCAL_TRIAL_PROPOSAL_ID)}`,
    title,
    brief: description,
    seed: rotationSeed(LOCAL_TRIAL_PROPOSAL_ID),
    tip: "Local draft trial — play your creation before proposing it.",
    goals: { minImpact: 0 },
    drivers: ["local draft"],
    words: ROTATION_WORDS,
    tokenBudget: ROTATION_TOKEN_BUDGET,
    story: [
      description,
      "A local draft plays exactly like a rotation trial, minus the publish.",
      `Clear “${title}” — finish the match to take the trial.`,
    ],
    assets: parsed.ok ? parsed.value : null,
  };
}
