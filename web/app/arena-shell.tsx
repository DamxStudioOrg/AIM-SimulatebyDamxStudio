"use client";

import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import gsap from "gsap";
import { CHALLENGES, TOTE_CHALLENGES, goalSummary } from "@/lib/challenges";
import type { Challenge } from "@/lib/challenges";
import { ghostSeries } from "@/lib/ghost-race";
import type { Ghost } from "@/lib/leagues";
import { badgeLabels } from "@/lib/server-board";
import { turnDelta } from "@/lib/turn-delta";
import { bestSeedReference, gapLines } from "@/lib/loss-gap";
import { estimateCostUsd } from "@/lib/pricing";
import { modelHealth } from "@/lib/model-health";
import { hasProviderKey, tokenKeyForModel } from "@/lib/vault";
import AccountPanel from "./account-panel";
import ApiKeysCard from "./api-keys-card";
import { useAuth } from "./auth-context";

import { DEMO_PROMPT, DEMO_RESULT } from "./demo-match";
import CityCanvas from "./city-canvas";
import CostChip from "./cost-chip";
import CreatorPanel from "./creator-panel";
import { EnvironmentPanel } from "./environment-panel";
import FieldPlanPanel from "./field-plan-panel";
import GhostRacePanel from "./ghost-race-panel";
import LeaguesPanel from "./leagues-panel";
import HowSlideshow from "./how-slideshow";
import LocalSimCard from "./local-sim-card";
import LaneScroll from "./lane-scroll";
import RanksAnalytics from "./ranks-analytics";
import AnalyticsPanel from "./analytics-panel";
import ShareRow from "./share-row";
import SigninGate from "./signin-gate";
import PromptsPanel from "./prompts-panel";
import RanksPanel from "./ranks-panel";
import TaskCard from "./task-card";
import { ToteResult, ToteSubmit } from "./tote-panel";
import ToteCanvas from "./tote-canvas";
import TurnInspect from "./turn-inspect";
import TurnRules from "./turn-rules";

import { useMode } from "./mode-context";
import type { CenterView } from "./stage-view-tools";
import MoonDock from "./moon-dock";
import PlanetPanel from "./planet-panel";
import ProgressStrip from "./progress-strip";
import ProgressBoard from "./progress-board";
import { kindLabel, useMatch } from "./use-match";
import { useOnline } from "./use-online";
import { useSimRoute } from "./use-sim-route";
import type { RanksSnapshot } from "@/lib/server-board";
import { panelPadTop } from "@/lib/site-background";
import { readBotNickname } from "@/lib/auth";
import { entryGame, formatHistoryWhen } from "@/lib/history";
import type { HistoryEntry } from "@/lib/history";
import { useHistory } from "./use-history";
import { useTote } from "./use-tote";

type RailTab =
  "how" | "docs" | "connect" | "prompts" | "create" | "leagues" | "ranks" | "account";
type View = RailTab | "play";

const TABS: { id: RailTab; label: string }[] = [
  { id: "how", label: "How to simulate" },
  { id: "docs", label: "Docs" },
  { id: "connect", label: "Connect a bot" },
  { id: "prompts", label: "My prompts" },
  { id: "create", label: "Create" },
  { id: "leagues", label: "Leagues" },
  { id: "ranks", label: "Ranks" },
  { id: "account", label: "Account" },
];

const SIGNED_IN_TABS: readonly RailTab[] = ["connect", "prompts", "create", "leagues"];

/** Stack tabs float the moon; keep in step with the stack query in styles/planet.css. */
const STACK_MEDIA = "(min-width: 70rem)";

/** Re-measure delay so the rail rise animation has settled its rects. */
const RAIL_SETTLE_MS = 450;

function tabFromHash(): View {
  if (typeof window === "undefined") {
    return "how";
  }
  const hash = window.location.hash.replace("#", "");
  if (
    hash === "how" ||
    hash === "docs" ||
    hash === "connect" ||
    hash === "prompts" ||
    hash === "create" ||
    hash === "leagues" ||
    hash === "ranks" ||
    hash === "account" ||
    hash === "play"
  ) {
    return hash;
  }
  return "how";
}

function historyResult(entry: HistoryEntry): string {
  if (entryGame(entry) === "tote") {
    return `score ${(entry.score ?? 0).toFixed(1)} · damage ${(entry.damage ?? 0).toFixed(1)}`;
  }
  return `impact ${(entry.impact ?? 0).toFixed(1)} · efficiency ${(entry.efficiency ?? 0).toFixed(1)}`;
}

function ghostKeyFor(entry: HistoryEntry): string {
  return `${entry.when}|${String(entry.seed)}|${entry.provider}`;
}

export default function ArenaShell({
  docs,
}: Readonly<{ docs: ReactNode }>): React.ReactElement {
  const auth = useAuth();
  const historyApi = useHistory();
  const match = useMatch(historyApi);
  const online = useOnline();
  const { route: simRoute, endpoint: simEndpoint } = useSimRoute();
  const {
    contract,
    contractError,
    prompt,
    setPrompt,
    seedText,
    setSeedText,
    model,
    setModel,
    challengeId,
    unlocked,
    rankBonus,
    rankPosition,
    running,
    result,
    replayWhen,
    replayEntry,
    runId,
    activeTurn,
    setActiveTurn,
    selectedTurn,
    setSelectedTurn,
    plan,
    setPlan,
    resultAssets,
    error,
    history,
    words,
    cap,
    budget,
    overCap,
    seedValid,
    canRun,
    runMatch,
    boardPosition,
    activeChallenge,
    checks,
    cleared,
    pickChallenge,
    pickRotation,
  } = match;
  const [tab, setTab] = useState<View>("how");
  const [ghostKey, setGhostKey] = useState<string | null>(null);
  const ghost =
    ghostKey === null
      ? null
      : (history.find((entry) => ghostKeyFor(entry) === ghostKey) ?? null);
  const [ranksSnapshot, setRanksSnapshot] = useState<RanksSnapshot | null>(null);
  const [toteTaskId, setToteTaskId] = useState("");
  const [toteArmed, setToteArmed] = useState(false);
  const activeToteChallenge = TOTE_CHALLENGES.find((entry) => entry.id === toteTaskId);
  const [focusField, setFocusField] = useState<string | null>(null);
  const tote = useTote();
  const railBody = useRef<HTMLDivElement>(null);
  const { mode, setMode } = useMode();
  const [centerView, setCenterView] = useState<CenterView>("game");

  /** Ranks also mounts its rail panel (hidden): it loads the board. */
  function selectCenterView(next: CenterView): void {
    setCenterView(next);
    if (next === "ranks") {
      pickTab("ranks");
    }
  }

  /** Prompts are written in Controls, on the play tab. */
  function editPrompt(): void {
    setMode("controls");
    pickTab("play");
  }

  useEffect(() => {
    setTab(tabFromHash());
    const onHash = (): void => {
      setTab(tabFromHash());
    };
    window.addEventListener("hashchange", onHash);
    return () => {
      window.removeEventListener("hashchange", onHash);
    };
  }, []);

  useEffect(() => {
    const host = railBody.current;
    if (host === null) {
      return;
    }
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      return;
    }
    const ctx = gsap.context(() => {
      gsap.from(host, {
        y: 14,
        opacity: 0,
        duration: 0.35,
        ease: "power2.out",
      });
      gsap.from(host.querySelectorAll("[data-rise]"), {
        y: 18,
        opacity: 0,
        duration: 0.45,
        ease: "power3.out",
        stagger: 0.07,
        delay: 0.08,
      });
    }, host);
    return () => {
      ctx.revert();
    };
  }, [tab]);

  const stackTab = mode === "controls" && tab !== "play";

  useEffect(() => {
    const body = railBody.current;
    if (body === null) {
      return;
    }
    // Stack tabs hold the title below the panel apex; anything else
    // clears the padding. No scroll updates: padding tracks the
    // layout, and the veil guards content while it scrolls.
    const measure = (): void => {
      if (!stackTab || !window.matchMedia(STACK_MEDIA).matches) {
        body.style.paddingTop = "";
        return;
      }
      const rect = body.getBoundingClientRect();
      const pad = panelPadTop(
        window.innerWidth,
        window.innerHeight,
        rect.top + window.scrollY,
      );
      body.style.paddingTop = `${String(pad)}px`;
    };
    measure();
    // The rail rise animation shifts rects for its first frames;
    // measure again once it has settled.
    const settle = window.setTimeout(measure, RAIL_SETTLE_MS);
    window.addEventListener("resize", measure);
    void document.fonts.ready.then(() => {
      measure();
    });
    return () => {
      window.clearTimeout(settle);
      window.removeEventListener("resize", measure);
      body.style.paddingTop = "";
    };
  }, [stackTab]);

  function playGhost(ghost: Ghost): void {
    if (ghost.game === "tote") {
      setToteTaskId("");
      setToteArmed(true);
      pickChallenge("");
      tote.setSeedText(String(ghost.seed));
      if (ghost.prompt !== null) {
        tote.setPrompt(ghost.prompt);
      }
    } else {
      setToteTaskId("");
      setToteArmed(false);
      if (ghost.prompt !== null) {
        setPrompt(ghost.prompt);
      }
      if (
        ghost.challenge !== null &&
        CHALLENGES.some((entry) => entry.id === ghost.challenge)
      ) {
        pickChallenge(ghost.challenge);
      } else {
        pickChallenge("");
        setSeedText(String(ghost.seed));
      }
    }
    pickTab("play");
  }

  function playRotation(challenge: Challenge): void {
    setToteTaskId("");
    setToteArmed(false);
    pickRotation(challenge);
    pickTab("play");
  }

  function replayRun(entry: HistoryEntry): boolean {
    if (entryGame(entry) === "tote") {
      setToteTaskId("");
      setToteArmed(true);
      return tote.replayEntry(entry);
    }
    setToteTaskId("");
    setToteArmed(false);
    return replayEntry(entry);
  }

  function editEntry(entry: HistoryEntry): void {
    const field = entryGame(entry) === "tote" ? "tote-prompt" : "arena-prompt";
    if (entryGame(entry) === "tote") {
      tote.setPrompt(entry.prompt);
      tote.setSeedText(String(entry.seed));
      setToteTaskId("");
      setToteArmed(true);
    } else {
      setPrompt(entry.prompt);
      setSeedText(String(entry.seed));
      setToteTaskId("");
      setToteArmed(false);
    }
    pickTab("play");
    // Already mounted: focus now. Otherwise the mounting form's ref
    // callback focuses, which also survives async remounts (the tote
    // offer popping in) that a timer-based focus cannot see.
    const node = document.getElementById(field);
    if (node instanceof HTMLElement) {
      node.focus();
    } else {
      setFocusField(field);
    }
  }

  function clearFocusField(): void {
    setFocusField(null);
  }

  function pickTask(id: string): void {
    const toteTask = TOTE_CHALLENGES.find((entry) => entry.id === id);
    if (toteTask !== undefined) {
      setToteTaskId(id);
      setToteArmed(false);
      pickChallenge("");
      tote.setSeedText(String(toteTask.seed));
    } else {
      setToteTaskId("");
      setToteArmed(false);
      pickChallenge(id);
    }
  }

  function pickTab(next: View): void {
    setTab(next);
    try {
      window.history.replaceState(null, "", `#${next}`);
    } catch {
      // Hash sync is cosmetic; a blocked history must not break tabs.
    }
    window.scrollTo(0, 0);
  }

  const canPlay = auth.signedIn && canRun;
  const live = result !== null;
  const showTote = activeToteChallenge !== undefined || toteArmed;

  return (
    <main className="arena-page" id="arena-page">
      <div data-mode={mode} data-tab={tab} className="arena-shell">
        <div className="panel game-panel stage-col">
          {mode === "simulation" ? (
            <>
              <div className="sim-stage" data-center={centerView}>
                {centerView === "ranks" ? (
                  <RanksAnalytics snapshot={ranksSnapshot} />
                ) : centerView === "stats" ? (
                  <ProgressBoard
                    completions={match.completions}
                    runCount={match.history.length}
                  />
                ) : showTote ? (
                  <ToteCanvas
                    key={tote.packId}
                    catalog={tote.catalog}
                    result={tote.result}
                    prompt={tote.prompt}
                  />
                ) : (
                  <CityCanvas
                    key={runId}
                    result={result ?? DEMO_RESULT}
                    prompt={live ? prompt : DEMO_PROMPT}
                    loop={!live}
                    selectedTurn={selectedTurn}
                    onTurnChange={setActiveTurn}
                    onSelectTurn={setSelectedTurn}
                    assets={resultAssets}
                  />
                )}
              </div>
              <MoonDock
                view={centerView}
                onSelect={selectCenterView}
                completions={match.completions}
              />
              {centerView === "game" && (
                <ProgressStrip
                  match={match}
                  canPlay={canPlay}
                  signedIn={auth.signedIn}
                  onEditPrompt={editPrompt}
                />
              )}
            </>
          ) : (
            <div
              className="controls-stage"
              role="button"
              tabIndex={0}
              title="Open in Simulation"
              onClick={(event) => {
                if (
                  (event.target as HTMLElement).closest(
                    "button, select, a, input, textarea",
                  ) !== null
                ) {
                  return;
                }
                if (tab === "ranks") {
                  setCenterView("ranks");
                }
                setMode("simulation");
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  if (tab === "ranks") {
                    setCenterView("ranks");
                  }
                  setMode("simulation");
                }
              }}
            >
              {tab === "ranks" ? (
                <RanksAnalytics snapshot={ranksSnapshot} />
              ) : showTote ? (
                <ToteCanvas
                  key={tote.packId}
                  catalog={tote.catalog}
                  result={tote.result}
                  prompt={tote.prompt}
                />
              ) : (
                <CityCanvas
                  key={runId}
                  result={result ?? DEMO_RESULT}
                  prompt={live ? prompt : DEMO_PROMPT}
                  loop={!live}
                  selectedTurn={selectedTurn}
                  onTurnChange={setActiveTurn}
                  onSelectTurn={setSelectedTurn}
                  assets={resultAssets}
                />
              )}
            </div>
          )}
        </div>

        <div className="rail">
          <nav aria-label="Arena sections" className="rail-tabs">
            {TABS.filter(
              (entry) => !SIGNED_IN_TABS.includes(entry.id) || auth.signedIn,
            ).map((entry) => (
              <a
                key={entry.id}
                href={`#${entry.id}`}
                aria-current={tab === entry.id ? "page" : undefined}
                className={tab === entry.id ? "tab-active" : undefined}
                onClick={(event) => {
                  event.preventDefault();
                  pickTab(entry.id);
                }}
              >
                {entry.label}
              </a>
            ))}
          </nav>

          <div
            ref={railBody}
            id="rail-body"
            className={tab === "play" ? "rail-body" : "rail-body doc"}
          >
            <PlanetPanel enabled>
              {tab === "play" && !auth.signedIn && (
                <>
                  <SigninGate
                    headingId="signin-heading"
                    title="Sign in to simulate"
                    hint="Your account is one random ID — no password, no email. Sessions stay on this machine."
                  />
                  <p className="cta-row">
                    <button
                      type="button"
                      className="ghost"
                      onClick={() => {
                        setMode("simulation");
                      }}
                    >
                      Watch the demo simulation first
                    </button>
                  </p>
                </>
              )}

              {tab === "play" && auth.signedIn && (
                <>
                  <section className="submit" aria-labelledby="arena-task-heading">
                    <h2 id="arena-task-heading" data-rise>
                      Pick a task
                    </h2>
                    <label htmlFor="arena-challenge">
                      Task (fixed seed, limits, and goals)
                    </label>
                    <select
                      id="arena-challenge"
                      value={toteTaskId !== "" ? toteTaskId : challengeId}
                      onChange={(event) => {
                        pickTask(event.target.value);
                      }}
                    >
                      <option value="">Open prompt — no challenge</option>
                      <optgroup label="City challenges">
                        {unlocked.map((challenge) => (
                          <option key={challenge.id} value={challenge.id}>
                            {challenge.title} — {goalSummary(challenge)}
                          </option>
                        ))}
                      </optgroup>
                      <optgroup label="Tote drop-ins">
                        {TOTE_CHALLENGES.map((challenge) => (
                          <option key={challenge.id} value={challenge.id}>
                            {challenge.title} — {goalSummary(challenge)}
                          </option>
                        ))}
                      </optgroup>
                    </select>
                    <TaskCard
                      challenge={activeToteChallenge ?? activeChallenge}
                      words={showTote ? tote.words : cap}
                      tokenBudget={
                        activeToteChallenge !== undefined
                          ? activeToteChallenge.tokenBudget
                          : budget
                      }
                      seedText={showTote ? tote.seedText : seedText}
                    />
                  </section>
                  {showTote ? (
                    <>
                      <ToteSubmit
                        tote={tote}
                        focusField={focusField}
                        onFocused={clearFocusField}
                        challenge={activeToteChallenge}
                      />
                      <ToteResult tote={tote} verdictChallenge={activeToteChallenge} />
                    </>
                  ) : (
                    <>
                      <section
                        className="submit"
                        aria-labelledby="arena-submit-heading"
                      >
                        <h2 id="arena-submit-heading" data-rise>
                          Submit a prompt
                        </h2>
                        {contractError !== null ? (
                          <p className="error" role="alert">
                            {contractError}
                          </p>
                        ) : (
                          <p className="hint">
                            {contract === null
                              ? "Contacting sim API…"
                              : `Sim ${contract.sim_version} · ${String(contract.turns)} turns · cap ${String(cap)} words · budget ${budget.toLocaleString("en-US")}`}
                          </p>
                        )}
                        <label htmlFor="arena-prompt">
                          System prompt for the agent
                        </label>
                        <textarea
                          id="arena-prompt"
                          ref={(node) => {
                            if (node !== null && focusField === "arena-prompt") {
                              node.focus();
                              clearFocusField();
                            }
                          }}
                          rows={8}
                          value={prompt}
                          disabled={!auth.signedIn}
                          onChange={(event) => {
                            setPrompt(event.target.value);
                          }}
                          placeholder="Steward the city budget, hold reserves, and respond fast when shocks hit…"
                        />
                        <p className={overCap ? "hint over" : "hint"}>
                          {words} / {cap} words
                          {overCap ? " — over cap, trimmed by nothing; fix it" : ""}
                          {rankBonus > 0 && rankPosition !== null
                            ? ` — includes +${String(rankBonus)} for Impact rank #${String(rankPosition)}`
                            : ""}
                        </p>
                        <label htmlFor="arena-seed">
                          Seed (same seed replays the same city)
                        </label>
                        <input
                          id="arena-seed"
                          type="number"
                          value={seedText}
                          disabled={activeChallenge !== undefined}
                          onChange={(event) => {
                            setSeedText(event.target.value);
                          }}
                        />
                        {!seedValid && (
                          <p className="hint over">Seed must be an integer.</p>
                        )}
                        <label htmlFor="arena-model">
                          Model (who simulates the turns)
                        </label>
                        <select
                          id="arena-model"
                          value={model}
                          disabled={contract === null || contract.models.length === 0}
                          onChange={(event) => {
                            setModel(event.target.value);
                          }}
                        >
                          {(contract?.models ?? []).map((entry) => (
                            <option key={entry.id} value={entry.id}>
                              {entry.id} — {kindLabel(entry.kind)}
                            </option>
                          ))}
                        </select>
                        {model !== "" &&
                          (() => {
                            const entry = contract?.models.find((m) => m.id === model);
                            const health = modelHealth(
                              entry?.kind ?? "hosted",
                              hasProviderKey(tokenKeyForModel(model)),
                            );
                            return (
                              <p className="hint" role="status">
                                {health.label}
                              </p>
                            );
                          })()}
                        {model !== "" &&
                          (() => {
                            const estimate = estimateCostUsd(budget, model);
                            if (estimate === null) {
                              return (
                                <p className="hint">
                                  Cost at the {budget.toLocaleString()} token budget:
                                  rate unknown for this model.
                                </p>
                              );
                            }
                            return (
                              <p className="hint">
                                {estimate === 0
                                  ? "Free — local models cost nothing to run."
                                  : `Estimated cost at the ${budget.toLocaleString()} token budget: $${estimate.toFixed(3)}.`}
                              </p>
                            );
                          })()}
                        {!online && (
                          <p className="hint" role="status">
                            You&apos;re offline — reconnect to run a match.
                          </p>
                        )}
                        {online && simRoute === "direct" && (
                          <p className="hint" role="status">
                            Local mode — running via {simEndpoint}.
                          </p>
                        )}
                        <button
                          type="button"
                          data-fx="cta"
                          disabled={!canPlay || !online}
                          onClick={() => {
                            void runMatch();
                          }}
                        >
                          {running ? "Match running…" : "Run match"}
                        </button>
                        {error !== null && (
                          <p className="error" role="alert">
                            {error}
                          </p>
                        )}
                      </section>

                      <FieldPlanPanel
                        plan={plan}
                        onChange={setPlan}
                        disabled={running}
                        idPrefix="arena"
                      />

                      {result !== null && (
                        <section
                          className="result"
                          aria-labelledby="arena-result-heading"
                        >
                          <h2 id="arena-result-heading">Result</h2>
                          <p className="match-meta">
                            Seed {result.seed} · {result.provider} ·{" "}
                            {(result.totals.tokens_used ?? 0).toLocaleString()} tokens ·{" "}
                            {(result.totals.spend ?? 0).toLocaleString()} spent
                            <CostChip
                              tokens={result.totals.tokens_used ?? 0}
                              model={model}
                            />
                            {boardPosition !== null && (
                              <>
                                {" "}
                                · <a href="/ranks">live board #{boardPosition}</a>
                              </>
                            )}
                            {replayWhen !== null && (
                              <> · replay of {formatHistoryWhen(replayWhen)}</>
                            )}
                            {(result.totals.interventions_used ?? 0) > 0 && (
                              <>
                                {" "}
                                · {result.totals.interventions_used} field
                                {(result.totals.interventions_used ?? 0) === 1
                                  ? " nudge"
                                  : " nudges"}
                              </>
                            )}
                          </p>
                          {selectedTurn !== null ? (
                            <TurnInspect
                              result={result}
                              turn={selectedTurn}
                              onClose={() => {
                                setSelectedTurn(null);
                              }}
                            />
                          ) : (
                            <p className="hint">
                              {turnDelta(result.turns, activeTurn)} · Pick a turn on the
                              stage to inspect it.
                            </p>
                          )}
                          {result.badges.length > 0 && (
                            <p className="badges" role="status">
                              Badges{" "}
                              {badgeLabels(result.badges).map((label) => (
                                <span key={label} className="pill">
                                  {label}
                                </span>
                              ))}
                            </p>
                          )}
                          {(result.totals.usage_anomalies ?? 0) > 0 && (
                            <p className="error" role="alert">
                              Usage check flagged {result.totals.usage_anomalies ?? 0}{" "}
                              turn
                              {(result.totals.usage_anomalies ?? 0) === 1 ? "" : "s"}:
                              reported tokens diverged from the estimate, so this
                              run&apos;s budget accounting is suspect.
                            </p>
                          )}
                          <h3>Score breakdown</h3>
                          <table>
                            <thead>
                              <tr>
                                <th scope="col">Score</th>
                                <th scope="col" className="num">
                                  Value
                                </th>
                              </tr>
                            </thead>
                            <tbody>
                              {Object.entries(result.scores).map(([name, value]) => (
                                <tr key={name}>
                                  <th scope="row">{name}</th>
                                  <td className="num">{value.toFixed(2)}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                          <h3>Loss reasons</h3>
                          <ul className="tight">
                            {result.loss_reasons.map((reason) => (
                              <li key={reason}>{reason}</li>
                            ))}
                          </ul>
                          {(() => {
                            const reference = bestSeedReference(history, result);
                            if (reference === null) return null;
                            const lines = gapLines(result, reference);
                            if (lines.length === 0) return null;
                            return (
                              <>
                                <h3>Where your best run on this seed did better</h3>
                                <ul className="tight">
                                  {lines.map((line) => (
                                    <li key={line}>{line}</li>
                                  ))}
                                </ul>
                              </>
                            );
                          })()}
                          <AnalyticsPanel result={result} />
                          {result.environment !== undefined && (
                            <EnvironmentPanel environment={result.environment} />
                          )}
                          {activeChallenge !== undefined && (
                            <div
                              className={cleared ? "verdict verdict-pass" : "verdict"}
                              role="status"
                            >
                              <h3>
                                {cleared ? "Challenge cleared" : "Challenge missed"} —{" "}
                                {activeChallenge.title}
                              </h3>
                              <ul className="tight">
                                {checks.map((check) => (
                                  <li
                                    key={check.label}
                                    className={check.passed ? "pass" : "miss"}
                                  >
                                    {check.passed ? "✓" : "✗"} {check.label} — now{" "}
                                    {check.actual}
                                  </li>
                                ))}
                              </ul>
                            </div>
                          )}
                          <TurnRules highlight={selectedTurn ?? activeTurn} />
                        </section>
                      )}

                      <section
                        className="history"
                        aria-labelledby="arena-history-heading"
                      >
                        <h2 id="arena-history-heading">This browser&apos;s runs</h2>
                        {history.length === 0 ? (
                          <p className="empty">
                            Nothing recorded yet. History stays in this browser only.
                          </p>
                        ) : (
                          <>
                            <table>
                              <thead>
                                <tr>
                                  <th scope="col">When</th>
                                  <th scope="col">Game</th>
                                  <th scope="col" className="num">
                                    Seed
                                  </th>
                                  <th scope="col">Result</th>
                                  <th scope="col">Race</th>
                                </tr>
                              </thead>
                              <tbody>
                                {history.map((entry) => {
                                  const key = ghostKeyFor(entry);
                                  const raceable = ghostSeries(entry) !== null;
                                  return (
                                    <tr
                                      key={`${entryGame(entry)}-${entry.when}-${String(entry.seed)}`}
                                    >
                                      <td>{entry.when}</td>
                                      <td>
                                        {entryGame(entry) === "tote" ? "Tote" : "City"}
                                      </td>
                                      <td className="num">{entry.seed}</td>
                                      <td>{historyResult(entry)}</td>
                                      <td>
                                        {!raceable ? (
                                          <span className="hint">
                                            {entryGame(entry) === "tote"
                                              ? "—"
                                              : "no timing"}
                                          </span>
                                        ) : ghostKey === key ? (
                                          <span className="hint">racing</span>
                                        ) : (
                                          <button
                                            type="button"
                                            className="ghost"
                                            onClick={() => {
                                              setGhostKey(key);
                                            }}
                                          >
                                            Race
                                          </button>
                                        )}
                                      </td>
                                    </tr>
                                  );
                                })}
                              </tbody>
                            </table>
                            <button
                              type="button"
                              className="ghost"
                              onClick={() => {
                                setGhostKey(null);
                                historyApi.clearHistory();
                              }}
                            >
                              Clear history
                            </button>
                          </>
                        )}
                      </section>

                      {ghost !== null && (
                        <GhostRacePanel
                          ghost={ghost}
                          result={result}
                          activeTurn={selectedTurn ?? activeTurn}
                          onClear={() => {
                            setGhostKey(null);
                          }}
                        />
                      )}

                      <section aria-labelledby="arena-limits-heading">
                        <h2 id="arena-limits-heading">Limits</h2>
                        <table>
                          <thead>
                            <tr>
                              <th scope="col">Limit</th>
                              <th scope="col" className="num">
                                Value
                              </th>
                            </tr>
                          </thead>
                          <tbody>
                            <tr>
                              <th scope="row">Prompt</th>
                              <td className="num">≤ 250 words</td>
                            </tr>
                            <tr>
                              <th scope="row">Budget</th>
                              <td className="num">≤ 15,000 tokens</td>
                            </tr>
                            <tr>
                              <th scope="row">One turn</th>
                              <td className="num">≤ 1,200 tokens</td>
                            </tr>
                            <tr>
                              <th scope="row">Split</th>
                              <td className="num">8 keys sum to 100</td>
                            </tr>
                            <tr>
                              <th scope="row">Policies</th>
                              <td className="num">0–2 from the list</td>
                            </tr>
                            <tr>
                              <th scope="row">Field plan</th>
                              <td className="num">≤ 3 nudges, one per turn</td>
                            </tr>
                          </tbody>
                        </table>
                        <p className="hint">
                          Bad output skips the turn. The simulation goes on.
                        </p>
                      </section>

                      <section aria-labelledby="arena-scoring-heading">
                        <h2 id="arena-scoring-heading">Scoring</h2>
                        <ul className="tight">
                          <li>
                            <code>
                              Impact = 0.25·W + 0.30·L + 0.20·I + 0.15·E + 0.10·F
                            </code>
                          </li>
                          <li>
                            <code>
                              Efficiency = Impact / (1 + Dollars/500000 + Tokens/15000)
                            </code>
                          </li>
                        </ul>
                      </section>
                    </>
                  )}
                </>
              )}

              {tab === "how" && (
                <>
                  <section aria-labelledby="arena-how-heading">
                    <h2 id="arena-how-heading">How to simulate</h2>
                    <HowSlideshow />
                    <div className="download-row">
                      <p className="hint">
                        Download the desktop app to run locally, compare models, and
                        play the game mode
                      </p>
                      <div className="download-icons">
                        <a
                          href="#"
                          className="download-btn"
                          aria-label="Download for macOS"
                        >
                          <span className="download-label">macOS</span>
                        </a>
                        <a
                          href="#"
                          className="download-btn"
                          aria-label="Download for Windows"
                        >
                          <span className="download-label">Windows</span>
                        </a>
                        <a
                          href="#"
                          className="download-btn"
                          aria-label="Download for Linux"
                        >
                          <span className="download-label">Linux</span>
                        </a>
                      </div>
                    </div>
                  </section>
                  <ShareRow />
                </>
              )}

              {tab === "docs" && (
                <section aria-labelledby="arena-docs-heading">
                  <h2 id="arena-docs-heading" data-rise>
                    Docs
                  </h2>
                  {docs}
                </section>
              )}

              {tab === "ranks" && <RanksPanel onSnapshot={setRanksSnapshot} />}

              {tab === "account" && (
                <section aria-labelledby="arena-account-heading">
                  <h2 id="arena-account-heading" data-rise>
                    Account
                  </h2>
                  <AccountPanel />
                </section>
              )}

              {tab === "connect" && !auth.signedIn && (
                <SigninGate
                  headingId="signin-locked-heading"
                  title="Sign in to connect a bot"
                  hint="Bot setup unlocks after sign-in. Your account is one random ID — no password, no email. Sessions stay on this machine only."
                />
              )}

              {tab === "prompts" && !auth.signedIn && (
                <SigninGate
                  headingId="signin-prompts-heading"
                  title="Sign in to see your prompts"
                  hint="Your prompts land here after you simulate. Your account is one random ID — no password, no email."
                />
              )}

              {tab === "prompts" && auth.signedIn && (
                <PromptsPanel
                  entries={history}
                  onReplay={replayRun}
                  onEdit={editEntry}
                  onClear={historyApi.clearHistory}
                />
              )}

              {tab === "create" && !auth.signedIn && (
                <SigninGate
                  headingId="signin-create-heading"
                  title="Sign in to create challenges"
                  hint="Proposals and votes need an account. Your account is one random ID — no password, no email."
                />
              )}

              {tab === "create" && auth.signedIn && (
                <CreatorPanel
                  uid={auth.uid}
                  nickname={readBotNickname()}
                  models={contract?.models ?? []}
                />
              )}

              {tab === "leagues" && !auth.signedIn && (
                <SigninGate
                  headingId="signin-leagues-heading"
                  title="Sign in for leagues & duels"
                  hint="Leagues and ghosts are tied to your arena ID on this device. Your account is one random ID — no password, no email."
                />
              )}

              {tab === "leagues" && auth.signedIn && (
                <LeaguesPanel
                  uid={auth.uid}
                  nickname={readBotNickname()}
                  history={history}
                  onPlayGhost={playGhost}
                  onPlayRotation={playRotation}
                />
              )}

              {tab === "connect" && auth.signedIn && (
                <>
                  <section aria-labelledby="arena-connect-heading">
                    <h2 id="arena-connect-heading">Connect a bot</h2>
                    <p>
                      Bots are prompts only. Pick a seed, write a prompt, run the match.
                      The city replays each round.
                    </p>
                    <p className="hint">
                      Local models need their runtime running (Ollama with a pulled
                      model, or an OpenAI-compatible server). Hosted models run on your
                      key, encrypted on this device — never on a host key. Your prompt
                      and the city state still travel to the provider with each turn.
                    </p>
                    <p className="hint">
                      Playbooks per challenge:{" "}
                      <a
                        href="#docs"
                        onClick={(event) => {
                          event.preventDefault();
                          pickTab("docs");
                        }}
                      >
                        prompt field guide
                      </a>
                      .
                    </p>
                  </section>
                  <ApiKeysCard models={contract?.models ?? []} />
                  <LocalSimCard />
                  <section aria-labelledby="arena-challenges-heading">
                    <h2 id="arena-challenges-heading">Posted challenges</h2>
                    {unlocked.length < CHALLENGES.length && (
                      <p className="hint">
                        Clear each challenge to reveal the next one in the chain.
                      </p>
                    )}
                    <ul className="challenge-list">
                      {unlocked.map((challenge) => (
                        <li key={challenge.id}>
                          <div className="challenge-card-head">
                            <strong>{challenge.title}</strong>
                            <span className="challenge-chips">
                              {goalSummary(challenge)
                                .split(" · ")
                                .map((part) => (
                                  <span key={part} className="chip">
                                    {part}
                                  </span>
                                ))}
                            </span>
                          </div>
                          <span>{challenge.brief}</span>
                          <span className="hint">{challenge.tip}</span>
                        </li>
                      ))}
                    </ul>
                  </section>
                </>
              )}
            </PlanetPanel>
          </div>

          <LaneScroll body={railBody} />
        </div>
      </div>
    </main>
  );
}
