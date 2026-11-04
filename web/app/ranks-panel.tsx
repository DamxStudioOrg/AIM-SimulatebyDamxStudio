"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/base/buttons/button";
import { ArrowClockwiseIcon, TrophyIcon } from "@phosphor-icons/react";
import {
  clearedChallengeIds,
  isChallengeUnlocked,
  unlockedChallenges,
} from "@/lib/challenges";
import type {
  BoardFamily,
  BoardGame,
  BoardMetric,
  BoardPayload,
} from "@/lib/server-board";
import {
  FAMILY_LABELS,
  METRICS_FOR,
  badgeLabels,
  boardFamily,
  displayBotName,
  fetchBoard,
  mergeBoards,
} from "@/lib/server-board";
import type { RanksSnapshot } from "@/lib/server-board";
import { getOrCreateUid } from "@/lib/vault";
import { useAuth } from "./auth-context";
import { useCompletions } from "./use-completions";

type BoardScope = BoardGame | "all";

const SCOPES: { id: BoardScope; label: string }[] = [
  { id: "all", label: "Both shifts" },
  { id: "city", label: "City crisis" },
  { id: "tote", label: "Tote pack-out" },
];

const SHIFT_LABELS: Record<BoardGame, string> = {
  city: "City crisis",
  tote: "Tote pack-out",
};

const METRIC_LABELS: Record<BoardMetric, string> = {
  impact: "Impact",
  efficiency: "Efficiency",
  score: "Score",
};

const FAMILIES: { id: BoardFamily | "all"; label: string }[] = [
  { id: "all", label: "All families" },
  { id: "llama", label: "Llama" },
  { id: "openai", label: "OpenAI" },
  { id: "anthropic", label: "Anthropic" },
  { id: "open", label: "Other open" },
  { id: "other", label: "Other" },
];

const FETCH_LIMIT = 50;
const SHOWN_ROWS = 10;

/**
 * Live server board: one simulation, both shifts ranked together by
 * default (tote scores on the unified scale); a single shift keeps
 * its native metrics. Your best row shows when signed in.
 */
export default function RanksPanel({
  onSnapshot,
}: Readonly<{
  onSnapshot?: (snapshot: RanksSnapshot) => void;
}>): React.ReactElement {
  const auth = useAuth();
  const [scope, setScope] = useState<BoardScope>("all");
  const [metric, setMetric] = useState<BoardMetric>("impact");
  const effectiveMetric: BoardMetric = scope === "city" ? metric : "score";
  const [family, setFamily] = useState<BoardFamily | "all">("all");
  const { completions, loaded } = useCompletions();
  const cleared = useMemo(() => clearedChallengeIds(completions), [completions]);
  const [challenge, setChallenge] = useState<string>(
    () => window.localStorage.getItem("aim-arena-challenge") ?? "",
  );
  // The saved filter validates once the sealed read lands — never
  // against the flash of empty before it.
  useEffect(() => {
    if (loaded && challenge !== "" && !isChallengeUnlocked(challenge, cleared)) {
      setChallenge("");
    }
  }, [loaded, challenge, cleared]);
  const visible = useMemo(() => unlockedChallenges(cleared), [cleared]);
  const [payload, setPayload] = useState<BoardPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setFailed(false);
    let uid: string | undefined;
    if (auth.signedIn) {
      try {
        uid = getOrCreateUid();
      } catch {
        uid = undefined;
      }
    }
    let board: BoardPayload | null;
    if (scope === "all") {
      const [city, tote] = await Promise.all([
        fetchBoard("city", "impact", { uid, limit: FETCH_LIMIT }),
        fetchBoard("tote", "score", { uid, limit: FETCH_LIMIT }),
      ]);
      board = mergeBoards(city, tote);
    } else {
      board = await fetchBoard(scope, effectiveMetric, {
        uid,
        limit: FETCH_LIMIT,
        ...(scope === "city" && challenge !== "" ? { challenge } : {}),
      });
    }
    if (board === null) {
      setFailed(true);
      setPayload(null);
    } else {
      setPayload(board);
    }
    setLoading(false);
  }, [auth.signedIn, scope, effectiveMetric, challenge]);

  useEffect(() => {
    void load();
  }, [load]);

  function pickScope(next: BoardScope): void {
    setScope(next);
    if (next === "city") {
      setMetric("impact");
    }
  }

  const rows = (payload?.board ?? []).filter(
    (row) => family === "all" || boardFamily(row.model, row.provider) === family,
  );
  const shown = rows.slice(0, SHOWN_ROWS);
  const familyLabel = family === "all" ? null : FAMILY_LABELS[family];
  const hasAdjustments = shown.some(
    (row) => row.diversityPenalty !== 0 || row.badgeBoost !== 0,
  );

  // Stage analytics mirror the visible rows. Derive inside the effect from
  // stable state only — the sliced `shown` array is fresh each render and
  // must not be a dependency.
  useEffect(() => {
    if (onSnapshot === undefined) {
      return;
    }
    const snapRows = (payload?.board ?? [])
      .filter(
        (row) => family === "all" || boardFamily(row.model, row.provider) === family,
      )
      .slice(0, SHOWN_ROWS);
    const youRow = payload?.you ?? null;
    onSnapshot({
      game: scope,
      metric: effectiveMetric,
      challenge,
      failed,
      rows: snapRows.map((row) => ({
        position: row.position,
        name: displayBotName(row),
        value: row.value,
        you:
          youRow !== null && youRow.uid === row.uid && youRow.position === row.position,
      })),
    });
  }, [onSnapshot, scope, effectiveMetric, challenge, family, payload, failed]);

  function adjustmentTitle(row: (typeof shown)[number]): string | undefined {
    if (row.diversityPenalty === 0 && row.badgeBoost === 0) {
      return undefined;
    }
    const parts = [`raw ${row.value.toFixed(2)}`];
    if (row.diversityPenalty !== 0) {
      parts.push(`diversity −${row.diversityPenalty.toFixed(2)}`);
    }
    if (row.badgeBoost !== 0) {
      parts.push(`past badges +${row.badgeBoost.toFixed(2)}`);
    }
    return `Ranked on the adjusted value (${parts.join(" · ")}).`;
  }

  return (
    <section aria-labelledby="arena-ranks-heading">
      <h2 id="arena-ranks-heading" data-rise>
        <TrophyIcon size={20} aria-hidden="true" /> Live board
      </h2>
      <p className="hint">
        One simulation, two shifts: every signed-in run lands here, ranked by the board
        server. Both shifts share one table — pack scores ride the unified 0–100 scale
        beside city impact. This browser&apos;s history stays local; the board is
        shared.
      </p>
      <div className="board-pick">
        <label htmlFor="ranks-simulation">Simulation</label>
        <select
          id="ranks-simulation"
          value={scope}
          onChange={(event) => {
            pickScope(event.target.value as BoardScope);
          }}
        >
          {SCOPES.map((entry) => (
            <option key={entry.id} value={entry.id}>
              {entry.label}
            </option>
          ))}
        </select>
        <label htmlFor="ranks-metric">Ranked by</label>
        <select
          id="ranks-metric"
          value={effectiveMetric}
          onChange={(event) => {
            setMetric(event.target.value as BoardMetric);
          }}
        >
          {(scope === "city" ? METRICS_FOR.city : (["score"] as BoardMetric[])).map(
            (entry) => (
              <option key={entry} value={entry}>
                {METRIC_LABELS[entry]}
              </option>
            ),
          )}
        </select>
        <label htmlFor="ranks-family">Family</label>
        <select
          id="ranks-family"
          value={family}
          onChange={(event) => {
            setFamily(event.target.value as BoardFamily | "all");
          }}
        >
          {FAMILIES.map((entry) => (
            <option key={entry.id} value={entry.id}>
              {entry.label}
            </option>
          ))}
        </select>
        {scope === "city" && (
          <>
            <label htmlFor="ranks-challenge">Challenge</label>
            <select
              id="ranks-challenge"
              value={challenge}
              onChange={(event) => {
                setChallenge(event.target.value);
              }}
            >
              <option value="">All trials</option>
              {visible.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.title}
                </option>
              ))}
            </select>
          </>
        )}
        <Button
          variant="ghost"
          size="small"
          onClick={() => {
            void load();
          }}
          disabled={loading}
        >
          <ArrowClockwiseIcon size={16} aria-hidden="true" />
          {loading ? "Loading…" : "Refresh"}
        </Button>
      </div>
      {failed && (
        <p className="error" role="alert">
          The live board is down. Runs still score locally — start the board server and
          refresh.
        </p>
      )}
      {!failed && !loading && (payload === null || payload.board.length === 0) && (
        <p className="empty">
          No runs posted yet. Sign in, run a match, and take the top spot.
        </p>
      )}
      {!failed &&
        !loading &&
        payload !== null &&
        payload.board.length > 0 &&
        rows.length === 0 &&
        familyLabel !== null && (
          <p className="empty">
            No {familyLabel.toLowerCase()} runs on this board yet — switch the family
            filter or post the first one.
          </p>
        )}
      {shown.length > 0 && (
        <>
          <table>
            <thead>
              <tr>
                <th scope="col" className="num">
                  #
                </th>
                <th scope="col">Bot</th>
                <th scope="col">Badges</th>
                <th scope="col" className="num">
                  Seed
                </th>
                <th scope="col">Model</th>
                <th scope="col">Family</th>
                <th scope="col">Build</th>
                <th scope="col" className="num">
                  {METRIC_LABELS[effectiveMetric]}
                </th>
              </tr>
            </thead>
            <tbody>
              {shown.map((row) => (
                <tr key={`${String(row.position)}-${row.uid}`}>
                  <td className="num">{row.position}</td>
                  <td>
                    {displayBotName(row)}{" "}
                    {scope === "all" && (
                      <span className="pill">{SHIFT_LABELS[row.game]}</span>
                    )}
                  </td>
                  <td>{badgeLabels(row.badges).join(", ") || "–"}</td>
                  <td className="num">{row.seed}</td>
                  <td>{row.model}</td>
                  <td>
                    <span className="pill">
                      {FAMILY_LABELS[boardFamily(row.model, row.provider)]}
                    </span>
                  </td>
                  <td>{row.provider}</td>
                  <td className="num" title={adjustmentTitle(row)}>
                    {row.value.toFixed(2)}
                    {(row.diversityPenalty !== 0 || row.badgeBoost !== 0) && " *"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {family !== "all" && (
            <p className="hint">
              Top {shown.length} of {rows.length} {FAMILY_LABELS[family]} runs
              (positions are overall board ranks).
            </p>
          )}
          {hasAdjustments && (
            <p className="hint">
              Starred values rank on an adjusted score: crowded strategies lose a
              little, bots with badges from earlier simulations gain a little. Hover a
              value for the breakdown.
            </p>
          )}
        </>
      )}
      {payload?.you != null && (
        <p className="verdict verdict-pass" role="status">
          Your best {METRIC_LABELS[effectiveMetric].toLowerCase()} run sits at #
          {payload.you.position} with {payload.you.value.toFixed(2)}.
        </p>
      )}
      {!auth.signedIn && (
        <p className="hint">Sign in to post your runs and see your rank.</p>
      )}
      <p className="hint">
        Racing a rival? Share a duel target from{" "}
        <a href="#leagues-heading">Leagues &amp; duels</a> below — league ghosts replay
        your seeds on their own prompts.
      </p>
    </section>
  );
}
