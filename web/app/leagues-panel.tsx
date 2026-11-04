"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/base/buttons/button";
import { TrophyIcon } from "@phosphor-icons/react";
import { summarizeAssets } from "@/lib/asset-schema";
import type { Challenge } from "@/lib/challenges";
import { fetchProposals } from "@/lib/community";
import type { CommunityProposal } from "@/lib/community";
import { entryGame, formatHistoryWhen } from "@/lib/history";
import type { HistoryEntry } from "@/lib/history";
import { toteNorm100 } from "@/lib/challenges";
import {
  GHOSTS_KEY,
  LEAGUES_KEY,
  RATINGS_KEY,
  TRIALS_KEY,
  createLeague,
  decodeShareCode,
  duelFromEntry,
  encodeShareCode,
  entryStanding,
  ghostFromDuel,
  ghostStanding,
  inSeason,
  loadGhosts,
  loadLeagues,
  loadRatings,
  loadTrials,
  mergeLeague,
  ratingFor,
  resolveDuels,
  rotationChallenge,
  seasonFor,
  standingsFor,
  trialChallenge,
  upsertTrial,
} from "@/lib/leagues";
import type { Ghost, League, StandingEntry, TrialSnapshot } from "@/lib/leagues";
import { loadSealedText, sealText } from "@/lib/sealed-store";
import { displayBotName } from "@/lib/server-board";
import { getOrCreateUid } from "@/lib/vault";

function save(key: string, value: unknown): void {
  void sealText(window.localStorage, key, getOrCreateUid(), JSON.stringify(value));
}

function entryLabel(entry: HistoryEntry): string {
  const score =
    entryGame(entry) === "tote"
      ? `score ${(entry.score ?? 0).toFixed(1)}`
      : `impact ${(entry.impact ?? 0).toFixed(1)}`;
  return `${formatHistoryWhen(entry.when)} · ${entryGame(entry)} · seed ${String(entry.seed)} · ${score}`;
}

/** One-simulation value: tote pack scores ride the unified scale. */
function unifiedValue(kind: "city" | "tote", value: number): number {
  return kind === "tote" ? toteNorm100(value) : value;
}

function outcomeLabel(ghost: Ghost): string {
  if (ghost.outcome === "won") {
    return "Won — your best beat the target";
  }
  if (ghost.outcome === "lost") {
    return "Lost — the target stands";
  }
  if (ghost.outcome === "tied") {
    return "Tied — dead level on the seed";
  }
  return "Pending — run the seed to settle it";
}

/**
 * Local-first social layer: share codes, browser leagues, 14-day
 * seasons, device-local Elo, and the community rotation. Nothing here
 * leaves this machine except the codes you copy yourself.
 */
export default function LeaguesPanel({
  uid,
  nickname,
  history,
  onPlayGhost,
  onPlayRotation,
}: Readonly<{
  uid: string;
  nickname: string | null;
  history: HistoryEntry[];
  onPlayGhost: (ghost: Ghost) => void;
  onPlayRotation: (challenge: Challenge) => void;
}>): React.ReactElement {
  const [leagues, setLeagues] = useState<League[]>([]);
  const [ghosts, setGhosts] = useState<Ghost[]>([]);
  const [ratings, setRatings] = useState<Record<string, number>>({});
  const [loaded, setLoaded] = useState(false);
  const [leagueName, setLeagueName] = useState("");
  const [importText, setImportText] = useState("");
  const [shareWhen, setShareWhen] = useState("");
  const [shareOut, setShareOut] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [trials, setTrials] = useState<TrialSnapshot[]>([]);
  const [scope, setScope] = useState<"season" | "all">("season");
  const [leagueFilter, setLeagueFilter] = useState("");
  const [proposals, setProposals] = useState<CommunityProposal[] | null>(null);
  const [boardDown, setBoardDown] = useState(false);

  useEffect(() => {
    let live = true;
    const store = window.localStorage;
    const uid = getOrCreateUid();
    void Promise.all([
      loadSealedText(store, LEAGUES_KEY, uid),
      loadSealedText(store, GHOSTS_KEY, uid),
      loadSealedText(store, RATINGS_KEY, uid),
      loadSealedText(store, TRIALS_KEY, uid),
    ]).then(([leagueRead, ghostRead, ratingRead, trialRead]) => {
      if (!live) {
        return;
      }
      setLeagues(loadLeagues(leagueRead.text));
      setGhosts(loadGhosts(ghostRead.text));
      setRatings(loadRatings(ratingRead.text));
      setTrials(loadTrials(trialRead.text));
      setLoaded(true);
    });
    return () => {
      live = false;
    };
  }, []);

  useEffect(() => {
    if (!loaded) {
      return;
    }
    const resolved = resolveDuels(history, ghosts, ratings, uid);
    if (resolved.settled.length === 0) {
      return;
    }
    setGhosts(resolved.ghosts);
    setRatings(resolved.ratings);
    save(GHOSTS_KEY, resolved.ghosts);
    save(RATINGS_KEY, resolved.ratings);
    const last = resolved.settled[resolved.settled.length - 1];
    if (last !== undefined) {
      setNotice(`Duel settled against ${displayBotName(last)}: ${outcomeLabel(last)}.`);
    }
    // Rescanning is safe: settled ghosts never settle twice, so the
    // follow-up run finds nothing and leaves state alone.
  }, [loaded, history, ghosts, ratings, uid]);

  useEffect(() => {
    let live = true;
    void fetchProposals().then((list) => {
      if (!live) {
        return;
      }
      if (list === null) {
        setBoardDown(true);
        return;
      }
      setProposals(list);
    });
    return () => {
      live = false;
    };
  }, []);

  async function copyText(text: string, ready: string): Promise<void> {
    setShareOut(text);
    try {
      await navigator.clipboard.writeText(text);
      setNotice(ready);
    } catch {
      setNotice("Copy failed — select the code below and copy it manually.");
    }
  }

  function shareDuel(includePrompt: boolean): void {
    setError(null);
    const entry =
      history.find((candidate) => candidate.when === shareWhen) ?? history[0];
    if (entry === undefined) {
      setError("Run a match or a pack first — a duel code needs a finished run.");
      return;
    }
    const duel = duelFromEntry(entry, { nickname, includePrompt });
    if (duel === null) {
      setError("That run has no arena ID recorded — rerun it to share a duel.");
      return;
    }
    void copyText(
      encodeShareCode(duel),
      includePrompt
        ? "Duel code with your prompt copied — anyone holding it can read the prompt."
        : "Duel target copied — it carries the seed and score to beat, never your prompt or keys.",
    );
  }

  function importCode(): void {
    setError(null);
    setNotice(null);
    const payload = decodeShareCode(importText);
    if (payload === null) {
      setError("That text is not a valid Aim share code — check the paste.");
      return;
    }
    if (payload.kind === "duel") {
      const ghost = ghostFromDuel(payload, new Date().toISOString());
      if (ghost.uid === uid) {
        setError("That duel is your own run — send it to a rival instead.");
        return;
      }
      if (ghosts.some((entry) => entry.id === ghost.id)) {
        setNotice("That ghost is already on this device.");
        return;
      }
      const next = [ghost, ...ghosts];
      setGhosts(next);
      save(GHOSTS_KEY, next);
      setImportText("");
      setNotice(
        `Ghost stored from ${displayBotName(ghost)} — ${ghost.game} seed ${String(ghost.seed)}, target ${ghost.value.toFixed(2)}. Simulate it to load the seed.`,
      );
      return;
    }
    if (payload.kind === "trial") {
      const next = upsertTrial(trials, payload.trial);
      setImportText("");
      // The trial lists only once the seal lands: Simulate crosses
      // to the console with just an id, and the console re-reads
      // this store — listing early would race the write.
      void sealText(
        window.localStorage,
        TRIALS_KEY,
        getOrCreateUid(),
        JSON.stringify(next),
      ).then(() => {
        setTrials(next);
        setNotice(
          `Trial “${payload.trial.title}” stored from ${displayBotName({ nickname: payload.trial.ownerNickname, uid: payload.trial.ownerUid })} — simulate it from Shared trials below.`,
        );
      });
      return;
    }
    const next = mergeLeague(leagues, payload.league, { uid, nickname });
    setLeagues(next);
    save(LEAGUES_KEY, next);
    setImportText("");
    setNotice(`Joined “${payload.league.name}” — standings now include its members.`);
  }

  function removeTrial(proposalId: number): void {
    const next = trials.filter((entry) => entry.proposalId !== proposalId);
    setTrials(next);
    save(TRIALS_KEY, next);
  }

  function addLeague(): void {
    setError(null);
    const league = createLeague(
      leagueName,
      uid,
      nickname,
      new Date().toISOString(),
      Date.now().toString(36).slice(-4),
    );
    if (league === null) {
      setError("Name the league and make sure this device has an arena ID.");
      return;
    }
    const next = [...leagues, league];
    setLeagues(next);
    save(LEAGUES_KEY, next);
    setLeagueName("");
    setNotice(
      `League “${league.name}” created on this device — copy its invite to bring rivals in.`,
    );
  }

  const season = seasonFor(new Date());
  const filterLeague = leagues.find((league) => league.id === leagueFilter);
  const memberUids =
    filterLeague === undefined ? undefined : filterLeague.members.map((m) => m.uid);
  // One simulation: both shifts stand together, tote pack scores
  // on the unified 0–100 scale beside city impact.
  const scopedRows: StandingEntry[] = [
    ...history.flatMap((entry) => {
      const standing = entryStanding(entry, uid, nickname);
      return standing === null
        ? []
        : [{ ...standing, value: unifiedValue(entryGame(entry), standing.value) }];
    }),
    ...ghosts.map((ghost) => {
      const standing = ghostStanding(ghost);
      return { ...standing, value: unifiedValue(ghost.game, standing.value) };
    }),
  ].filter((row) => scope === "all" || inSeason(row.when, season));
  const standings = standingsFor(scopedRows, memberUids);
  const featured = (proposals ?? []).filter((entry) => entry.featured);
  const eloIds = [...new Set([uid, ...ghosts.map((ghost) => ghost.uid)])].filter(
    (id) => id !== "",
  );

  return (
    <>
      <section aria-labelledby="leagues-heading">
        <h2 id="leagues-heading" data-rise>
          <TrophyIcon size={20} aria-hidden="true" /> Leagues &amp; duels
        </h2>
        <p className="hint">
          Local-first social: leagues, ghosts, seasons, and Elo live in this browser.
          Share codes travel by copy-paste over any channel — no server accounts, and a
          code never carries a provider key. Compare against the shared board{" "}
          <a href="#arena-ranks-heading">above</a>.
        </p>
        {notice !== null && (
          <p className="notice" role="status">
            {notice}
          </p>
        )}
        {error !== null && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <h3>Share a duel</h3>
        <p className="hint">
          Pick one of your finished runs. The target code carries the shift, seed,
          model, and score to beat. Add your prompt only when you want the rival to read
          it.
        </p>
        <label htmlFor="league-share-run">Your run</label>
        <select
          id="league-share-run"
          value={shareWhen}
          onChange={(event) => {
            setShareWhen(event.target.value);
          }}
        >
          <option value="">Latest run</option>
          {history.slice(0, 10).map((entry) => (
            <option key={entry.when} value={entry.when}>
              {entryLabel(entry)}
            </option>
          ))}
        </select>
        <p className="cta-row">
          <Button
            variant="secondary"
            size="small"
            onClick={() => {
              shareDuel(false);
            }}
          >
            Copy duel target
          </Button>{" "}
          <Button
            variant="ghost"
            size="small"
            onClick={() => {
              shareDuel(true);
            }}
          >
            Copy with prompt
          </Button>
        </p>
        {shareOut !== null && (
          <textarea
            aria-label="Share code"
            readOnly
            rows={3}
            value={shareOut}
            onFocus={(event) => {
              event.target.select();
            }}
          />
        )}
        <h3>Import a code</h3>
        <label htmlFor="league-import">Duel, trial, or league invite code</label>
        <textarea
          id="league-import"
          rows={3}
          value={importText}
          placeholder="Paste an AIM1. code here…"
          onChange={(event) => {
            setImportText(event.target.value);
          }}
        />
        <p className="cta-row">
          <Button
            variant="primary"
            size="small"
            disabled={importText.trim() === ""}
            onClick={importCode}
          >
            Import code
          </Button>
        </p>
      </section>

      <section aria-labelledby="league-standings-heading">
        <h3 id="league-standings-heading">Standings</h3>
        <p className="hint">
          {scope === "season"
            ? `${season.label} — only runs inside the window count; the end date is exclusive.`
            : "All time on this device."}{" "}
          Your runs and imported ghost targets stand together; a ghost counts once, at
          its target value.
        </p>
        <div className="board-pick">
          <label htmlFor="league-scope">Window</label>
          <select
            id="league-scope"
            value={scope}
            onChange={(event) => {
              setScope(event.target.value as "season" | "all");
            }}
          >
            <option value="season">Current season</option>
            <option value="all">All time</option>
          </select>
          <label htmlFor="league-filter">League</label>
          <select
            id="league-filter"
            value={leagueFilter}
            onChange={(event) => {
              setLeagueFilter(event.target.value);
            }}
          >
            <option value="">Everyone here</option>
            {leagues.map((league) => (
              <option key={league.id} value={league.id}>
                {league.name}
              </option>
            ))}
          </select>
        </div>
        {standings.length === 0 ? (
          <p className="empty">
            No runs in this window yet — run a simulation or import a ghost to open the
            table.
          </p>
        ) : (
          <table>
            <thead>
              <tr>
                <th scope="col" className="num">
                  #
                </th>
                <th scope="col">Bot</th>
                <th scope="col" className="num">
                  Best
                </th>
                <th scope="col" className="num">
                  Plays
                </th>
                <th scope="col" className="num">
                  Elo
                </th>
              </tr>
            </thead>
            <tbody>
              {standings.map((row, index) => (
                <tr key={row.uid}>
                  <td className="num">{index + 1}</td>
                  <td>
                    {displayBotName(row)}
                    {row.uid === uid ? " (you)" : ""}
                  </td>
                  <td className="num">{row.best.toFixed(2)}</td>
                  <td className="num">{row.plays}</td>
                  <td className="num">{ratingFor(ratings, row.uid)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <h3>Your leagues</h3>
        <label htmlFor="league-name">New league name</label>
        <input
          id="league-name"
          type="text"
          value={leagueName}
          maxLength={40}
          placeholder="Riverside crew"
          onChange={(event) => {
            setLeagueName(event.target.value);
          }}
        />
        <p className="cta-row">
          <Button
            variant="primary"
            size="small"
            disabled={leagueName.trim() === ""}
            onClick={addLeague}
          >
            Create league
          </Button>
        </p>
        {leagues.length === 0 ? (
          <p className="hint">No leagues yet — create one or import an invite code.</p>
        ) : (
          <ul className="prompt-list">
            {leagues.map((league) => (
              <li key={league.id}>
                <article>
                  <p className="prompt-meta">
                    <span>{league.name}</span>
                    <span className="chip">
                      {league.members.length}{" "}
                      {league.members.length === 1 ? "member" : "members"}
                    </span>
                  </p>
                  <p className="prompt-text">
                    {league.members.map((member) => displayBotName(member)).join(", ")}
                  </p>
                  <p className="prompt-actions">
                    <Button
                      variant="ghost"
                      size="small"
                      onClick={() => {
                        void copyText(
                          encodeShareCode({ version: 1, kind: "league", league }),
                          `Invite for “${league.name}” copied — rivals import it to join.`,
                        );
                      }}
                    >
                      Copy invite
                    </Button>
                  </p>
                </article>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="league-ghosts-heading">
        <h3 id="league-ghosts-heading">Ghosts &amp; Elo</h3>
        <p className="hint">
          Ratings start at 1200 and move only when a duel settles on this device (K 24,
          same-seed best run against the ghost target). They are local bragging rights,
          not a server rank.
        </p>
        {eloIds.length > 0 && (
          <table>
            <thead>
              <tr>
                <th scope="col">Bot</th>
                <th scope="col" className="num">
                  Elo
                </th>
              </tr>
            </thead>
            <tbody>
              {eloIds
                .map((id) => ({
                  id,
                  rating: ratingFor(ratings, id),
                  name:
                    id === uid
                      ? `${displayBotName({ nickname, uid: id })} (you)`
                      : displayBotName(
                          ghosts.find((ghost) => ghost.uid === id) ?? {
                            nickname: null,
                            uid: id,
                          },
                        ),
                }))
                .sort((a, b) => b.rating - a.rating)
                .map((row) => (
                  <tr key={row.id}>
                    <td>{row.name}</td>
                    <td className="num">{row.rating}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        )}
        {ghosts.length === 0 ? (
          <p className="hint">No ghosts yet — import a duel code to store a rival.</p>
        ) : (
          <ul className="prompt-list">
            {ghosts.map((ghost) => (
              <li key={ghost.id}>
                <article>
                  <p className="prompt-meta">
                    <span>{displayBotName(ghost)}</span>
                    <span className="chip">
                      {ghost.game === "tote" ? "Tote pack-out" : "City crisis"}
                    </span>
                    <span className="chip">Seed {ghost.seed}</span>
                    {ghost.prompt !== null && (
                      <span className="chip">Prompt shared</span>
                    )}
                  </p>
                  <p className="prompt-scores">
                    Target {ghost.metric} {ghost.value.toFixed(2)} · {ghost.model}
                  </p>
                  <p className="hint">{outcomeLabel(ghost)}</p>
                  <p className="prompt-actions">
                    <Button
                      variant="primary"
                      size="small"
                      onClick={() => {
                        onPlayGhost(ghost);
                      }}
                    >
                      Simulate this seed
                    </Button>
                  </p>
                </article>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="league-trials-heading">
        <h3 id="league-trials-heading">Shared trials</h3>
        <p className="hint">
          Created challenges stored from trial codes on this device. Share your own from
          Create in the operator console; rivals simulate them here without touching the
          ranked chain.
        </p>
        {trials.length === 0 ? (
          <p className="hint">
            No shared trials yet — import a trial code above to store one.
          </p>
        ) : (
          <ul className="proposal-list">
            {trials.map((trial) => {
              const challenge = trialChallenge(trial);
              return (
                <li key={trial.proposalId}>
                  <article>
                    <p className="prompt-meta">
                      <span>
                        {displayBotName({
                          nickname: trial.ownerNickname,
                          uid: trial.ownerUid,
                        })}
                      </span>
                      <span className="chip">{trial.model}</span>
                      <span className="pill">Shared</span>
                    </p>
                    <h4>{trial.title}</h4>
                    <p>{trial.description}</p>
                    <p className="prompt-scores">
                      Rotation seed {challenge.seed} · {challenge.words} words ·{" "}
                      {challenge.tokenBudget.toLocaleString("en-US")} tokens
                      {challenge.assets !== null && challenge.assets !== undefined && (
                        <> · dressed: {summarizeAssets(challenge.assets)}</>
                      )}
                    </p>
                    <p className="prompt-actions">
                      <Button
                        variant="primary"
                        size="small"
                        onClick={() => {
                          onPlayRotation(challenge);
                        }}
                      >
                        Simulate this trial
                      </Button>{" "}
                      <Button
                        variant="ghost"
                        size="small"
                        onClick={() => {
                          removeTrial(trial.proposalId);
                        }}
                      >
                        Remove
                      </Button>
                    </p>
                  </article>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section aria-labelledby="league-rotation-heading">
        <h3 id="league-rotation-heading">Community rotation</h3>
        <p className="hint">
          Featured Creator proposals as playable trials. Each keeps its own board scope
          and a finish-the-match goal; the ranked trial chain is untouched.
        </p>
        {boardDown && (
          <p className="error" role="alert">
            Board unreachable — featured trials live on the server. Local leagues and
            ghosts still work.
          </p>
        )}
        {!boardDown && featured.length === 0 && (
          <p className="hint">
            No featured trials yet — vote in Create to feature one.
          </p>
        )}
        {featured.length > 0 && (
          <ul className="proposal-list">
            {featured.map((entry) => {
              const trial = rotationChallenge(entry);
              return (
                <li key={entry.id}>
                  <article>
                    <p className="prompt-meta">
                      <span>{displayBotName(entry)}</span>
                      <span className="chip">{entry.model}</span>
                      <span className="pill">Featured</span>
                    </p>
                    <h4>{entry.title}</h4>
                    <p>{entry.description}</p>
                    <p className="prompt-scores">
                      Rotation seed {trial.seed} · {trial.words} words ·{" "}
                      {trial.tokenBudget.toLocaleString("en-US")} tokens
                      {trial.assets !== null && trial.assets !== undefined && (
                        <> · dressed: {summarizeAssets(trial.assets)}</>
                      )}
                    </p>
                    <p className="prompt-actions">
                      <Button
                        variant="primary"
                        size="small"
                        onClick={() => {
                          onPlayRotation(trial);
                        }}
                      >
                        Simulate this trial
                      </Button>
                    </p>
                  </article>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </>
  );
}
