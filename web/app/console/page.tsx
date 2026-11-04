"use client";

import {
  DRILLS,
  challengeById,
  challengePassed,
  evaluateToteChallenge,
  isDrillChallenge,
  nextPickAfterClear,
  nextUnifiedPlay,
  toteNorm100,
} from "@/lib/challenges";
import type { Challenge } from "@/lib/challenges";
import { buildCoaching } from "@/lib/coaching";
import { Button } from "@/components/base/buttons/button";
import AnalyticsDashboard from "../analytics-dashboard";
import ChallengeAftermath from "../challenge-aftermath";
import ChallengePicker from "../challenge-picker";
import ChainStrip from "../chain-strip";
import ChallengesPanel from "../challenges-panel";
import CreatorPanel from "../creator-panel";
import CostChip from "../cost-chip";
import { formatTokensWithThinking, trueTokenTotal } from "@/lib/pricing";
import DatasetsPanel from "../datasets-panel";
import { DEMO_PROMPT, DEMO_RESULT } from "../demo-match";
import DepartmentBrief from "../department-brief";
import { EnvironmentPanel } from "../environment-panel";
import PromptCraft from "../prompt-craft";
import PromptVersionGraph from "../prompt-version-graph";
import RunButton from "../run-button";
import CityCanvas from "../city-canvas";
import FieldPlanPanel from "../field-plan-panel";
import MoonStats from "../moon-stats";
import { useMoonTitle, useMoonVisual } from "../moon-visual";
import { useVisualSpy } from "../use-visual-spy";
import NavPanel from "../nav-panel";
import PageHeader from "../page-header";
import PlanetPanel from "../planet-panel";
import SigninGate from "../signin-gate";
import TaskCard from "../task-card";
import { ToteResult, ToteSubmit } from "../tote-panel";
import ToteCanvas from "../tote-canvas";
import TurnInspect from "../turn-inspect";
import TurnRules from "../turn-rules";
import { useEffect, useMemo, useRef, useState } from "react";
import { parsePlayParams } from "@/lib/console-link";
import { safeGetItem, safeSetItem } from "@/lib/safe-storage";
import { probeAuthStorage, readBotNickname } from "@/lib/auth";
import { useAuth } from "../auth-context";
import { useScrollHighlight } from "@/hooks/use-scroll-highlight";
import { fetchProposals } from "@/lib/community";
import { entryGame } from "@/lib/history";
import { craftCorrelation } from "@/lib/prompt-analysis";
import { focusDrill } from "@/lib/focus";
import { buildJudgeMessage, parseJudgeVerdict } from "@/lib/prompt-judge";
import type { JudgeVerdict } from "@/lib/prompt-judge";
import { judgePrompt } from "@/lib/sim";
import { loadProviderKey, tokenKeyForModel } from "@/lib/vault";
import {
  TRIALS_KEY,
  loadTrials,
  parseRotationId,
  rotationChallenge,
  trialChallenge,
} from "@/lib/leagues";
import { loadSealedText } from "@/lib/sealed-store";
import { allowanceLabel, limitsForModel } from "@/lib/model-limits";
import { kindLabel, useMatch } from "../use-match";
import type { RunProgress } from "../use-match";
import { useHistory } from "../use-history";
import { useTote } from "../use-tote";
import { link } from "@/lib/routing";

type ConsoleMode = "play" | "create";

const CONSOLE_MODE_KEY = "aim-console-mode";

/**
 * Run-button status while a match plays: which variant (when 3 run),
 * then the live turn count once the stream reports it.
 */
function runBusyLabel(progress: RunProgress | null, variety: boolean): string {
  const variant =
    variety && progress !== null && progress.specTotal > 1
      ? `Variant ${String(progress.specIndex + 1)} of ${String(progress.specTotal)} · `
      : "";
  if (progress === null || progress.turn <= 0) {
    return `${variant}Contacting model…`;
  }
  return `${variant}Turn ${String(progress.turn)} of ${String(progress.total)}`;
}

function readConsoleMode(): ConsoleMode | null {
  const stored = safeGetItem(CONSOLE_MODE_KEY);
  if (stored === "play" || stored === "create") {
    return stored;
  }
  // Deep links carry explicit play intent: skip the gate.
  if (typeof window !== "undefined") {
    const params = parsePlayParams(window.location.search);
    if (params.game !== undefined || params.challenge !== undefined) {
      return "play";
    }
    // Blocked storage could never persist the pick, so asking every
    // visit would nag — fail open to the play section instead.
    if (!probeAuthStorage()) {
      return "play";
    }
  }
  return null;
}

export default function ArenaConsole(): React.ReactElement {
  // Left panel while signed out: the gate publishes no stage, so
  // the title stands in. Signed in, the simulation always wins.
  useMoonTitle("Operator console");
  const [mode, setMode] = useState<ConsoleMode | null>(() => readConsoleMode());
  function selectMode(next: ConsoleMode): void {
    safeSetItem(CONSOLE_MODE_KEY, next);
    setMode(next);
  }
  const historyApi = useHistory();
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
    completions,
    unlocked,
    rankBonus,
    rankPosition,
    running,
    progress,
    result,
    runId,
    activeTurn,
    setActiveTurn,
    selectedTurn,
    setSelectedTurn,
    plan,
    setPlan,
    chaos,
    setChaos,
    variety,
    setVariety,
    variants,
    error,
    history,
    words,
    cap,
    budget,
    overCap,
    seedValid,
    canRun,
    runMatch,
    activeChallenge,
    boardPosition,
    resultChallenge,
    checks,
    cleared,
    pickChallenge,
    pickRotation,
    dismissResult,
    recordClear,
  } = useMatch(historyApi);
  // The tote pack-out is the console's second shift: same page, same
  // history store, its own runner. Tote trials arm from the shared
  // unified picker below (base tasks and endless replays alike).
  const tote = useTote();
  const [toteTaskId, setToteTaskId] = useState("");
  const [toteFocus, setToteFocus] = useState<string | null>(null);
  // The auto effect's last pick: while the selection still equals
  // it, late-arriving unlocks may refresh the given trial; any
  // real pick (picker, strip, retry, link, advance) clears it and
  // the auto effect stands down.
  const autoId = useRef<string | null>(null);
  const foundTask = toteTaskId === "" ? undefined : challengeById(toteTaskId);
  const toteTask = foundTask?.kind === "tote" ? foundTask : undefined;
  const isToteMode = toteTaskId !== "";

  function pickTask(id: string, keepResult = false): void {
    autoId.current = null;
    // The picker never empties — a stray empty pick falls back to
    // the given trial rather than resurrecting open play.
    const want =
      id === "" ? ((nextUnifiedPlay(completions) ?? unlocked[0])?.id ?? "") : id;
    if (want === "") {
      return;
    }
    const task = challengeById(want);
    if (task?.kind !== "tote") {
      setToteTaskId("");
      pickChallenge(want, keepResult);
      return;
    }
    setToteTaskId(want);
    pickChallenge("", keepResult);
    tote.setSeedText(String(task.seed));
    setToteFocus("tote-prompt");
  }
  const auth = useAuth();
  const [mainNode, setMainNode] = useState<HTMLDivElement | null>(null);
  useScrollHighlight(mainNode);

  // Retries re-pick the cleared trial first: auto-advance has
  // already moved the form on to the next challenge.
  function retryWithPrompt(): void {
    if (resultChallenge !== undefined) {
      pickTask(resultChallenge.id);
    }
    dismissResult();
    setPrompt("");
    document.getElementById("prompt")?.focus();
  }

  function retryWithModel(): void {
    const ids = (contract?.models ?? []).map((entry) => entry.id);
    const at = ids.indexOf(model);
    setModel(ids.length === 0 ? model : (ids[(at + 1) % ids.length] ?? model));
    if (resultChallenge !== undefined) {
      pickTask(resultChallenge.id);
    }
    dismissResult();
    document.getElementById("model")?.focus();
  }

  function goToChallenge(id: string): void {
    pickTask(id);
  }
  // Tier-4 judge: one rubric call on the player's own model,
  // only when asked — the verdict never auto-runs or bills itself.
  const [judging, setJudging] = useState(false);
  const [judgeVerdict, setJudgeVerdict] = useState<JudgeVerdict | null>(null);
  const [judgeMeta, setJudgeMeta] = useState<string | null>(null);
  const [judgeError, setJudgeError] = useState<string | null>(null);
  useEffect(() => {
    setJudgeVerdict(null);
    setJudgeMeta(null);
    setJudgeError(null);
  }, [result]);
  async function handleJudge(): Promise<void> {
    if (result === null || judging) {
      return;
    }
    const kind = contract?.models.find((entry) => entry.id === model)?.kind;
    let providerKey: string | undefined;
    if (kind === "hosted") {
      const tokenKey = tokenKeyForModel(model);
      try {
        providerKey = (await loadProviderKey(tokenKey)) ?? undefined;
      } catch {
        providerKey = undefined;
      }
      if (providerKey === undefined) {
        setJudgeError(`Add your own key for "${model}" under Connect a bot first.`);
        return;
      }
    }
    setJudging(true);
    setJudgeError(null);
    try {
      const judged = await judgePrompt(buildJudgeMessage(prompt, result), model, {
        uid: auth.uid,
        ...(providerKey === undefined ? {} : { providerKey }),
      });
      const verdict = parseJudgeVerdict(judged.verdict);
      if (verdict === null) {
        setJudgeError("The judge's reply didn't parse — try again.");
        return;
      }
      setJudgeVerdict(verdict);
      setJudgeMeta(`${judged.model} · ${String(judged.tokens_used)} tokens`);
    } catch (error) {
      setJudgeError(error instanceof Error ? error.message : "The judge call failed.");
    } finally {
      setJudging(false);
    }
  }
  // The console is match ops: packs live in the dashboard, not these stats.
  const matches = useMemo(
    () => history.filter((entry) => entryGame(entry) === "city"),
    [history],
  );
  // Recorded runs only: charts need per-turn replays, which runs saved
  // before replays lack. Newest first, so the dashboard compares the
  // latest run against the one before it. Memoized: the scroll-spy
  // map keys on these, and fresh arrays would re-publish forever.
  const recorded = useMemo(
    () =>
      matches.flatMap((entry) => {
        const result = entry.result;
        return result !== undefined && "turns" in result ? [result] : [];
      }),
    [matches],
  );
  // The player's own craft evidence: do their structured prompts
  // actually score better? Null until both sides have runs.
  const craftEntries = useMemo(
    () =>
      matches.flatMap((entry) =>
        typeof entry.impact === "number"
          ? [{ prompt: entry.prompt, impact: entry.impact }]
          : [],
      ),
    [matches],
  );
  const craft = useMemo(() => craftCorrelation(craftEntries), [craftEntries]);
  // Tier 5: name the drill that trains the player's recurring
  // weakness — measured run patterns first, then prompt gaps.
  const focusPick = useMemo(
    () =>
      focusDrill({
        prompts: craftEntries.map((entry) => entry.prompt),
        results: recorded,
      }),
    [craftEntries, recorded],
  );

  const signedIn = auth.signedIn;
  // Deep-links from leagues, prompts, and challenge lists land here
  // with ?challenge=&prompt=&seed=, plus ?game=tote for pack links.
  // Prompt and seed apply once, to the tote form when the link says
  // tote; the challenge applies when unlocks arrive (completions load
  // async) and only for unlocked trials, so links can't skip the
  // unified chain or clobber mid-session edits.
  const appliedOnce = useRef(false);
  const appliedChallenge = useRef<string | null>(null);
  useEffect(() => {
    if (appliedOnce.current) {
      return;
    }
    appliedOnce.current = true;
    // Link text applies once, to the tote form when the link says
    // tote; arming waits for unlocks in the effect below.
    const params = parsePlayParams(window.location.search);
    if (params.game === "tote") {
      if (params.prompt !== undefined) {
        tote.setPrompt(params.prompt);
        setToteFocus("tote-prompt");
      }
      if (params.seed !== undefined) {
        tote.setSeedText(params.seed);
      }
      return;
    }
    if (params.prompt !== undefined) {
      setPrompt(params.prompt);
    }
    if (params.seed !== undefined) {
      setSeedText(params.seed);
    }
  }, [setPrompt, setSeedText]);
  useEffect(() => {
    const params = parsePlayParams(window.location.search);
    if (
      params.challenge === undefined ||
      params.challenge === appliedChallenge.current
    ) {
      return;
    }
    const linked = challengeById(params.challenge);
    if (linked?.kind === "tote") {
      if (unlocked.some((entry) => entry.id === params.challenge)) {
        appliedChallenge.current = params.challenge;
        pickTask(params.challenge);
      }
      return;
    }
    if (
      unlocked.some((entry) => entry.id === params.challenge) ||
      isDrillChallenge(params.challenge)
    ) {
      appliedChallenge.current = params.challenge;
      pickTask(params.challenge);
    }
  }, [unlocked, pickTask]);
  // Created trials arm as rotation picks: the link carries
  // rotation-<proposalId>, resolved from this device's stored trial
  // snapshots first, then the board (own and featured proposals
  // live there). The id is claimed synchronously so auto-arm waits
  // out the lookup; a miss releases it back to the unified chain.
  // Deps mirror the link effect above (pickRotation is re-created
  // every render): SPA navigation can land the query after the
  // first commit, so the effect must keep re-reading the location
  // until the flight marker says this id is handled. The marker —
  // not an effect cleanup — owns cancellation, so re-renders never
  // kill the async lookup mid-flight; aliveRef covers unmount.
  const rotationMissed = useRef<string | null>(null);
  const rotationFlight = useRef<string | null>(null);
  const aliveRef = useRef(true);
  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);
  useEffect(() => {
    // The sealed trial store is keyed by arena ID: wait for it, or
    // the lookup misses and the miss latch would block the retry.
    if (auth.uid === "") {
      return;
    }
    const params = parsePlayParams(window.location.search);
    if (params.challenge === undefined) {
      return;
    }
    const proposalId = parseRotationId(params.challenge);
    if (
      proposalId === null ||
      rotationFlight.current === params.challenge ||
      rotationMissed.current === params.challenge
    ) {
      return;
    }
    rotationFlight.current = params.challenge;
    appliedChallenge.current = params.challenge;
    const wanted = params.challenge;
    async function resolveTrial(): Promise<void> {
      const read = await loadSealedText(window.localStorage, TRIALS_KEY, auth.uid);
      const stored = loadTrials(read.text).find(
        (entry) => entry.proposalId === proposalId,
      );
      let challenge: Challenge | undefined =
        stored === undefined ? undefined : trialChallenge(stored);
      if (challenge === undefined) {
        const proposals = await fetchProposals();
        const found = (proposals ?? []).find((entry) => entry.id === proposalId);
        if (found !== undefined) {
          challenge = rotationChallenge(found);
        }
      }
      if (challenge === undefined) {
        // A trial code imported moments ago may have sealed while
        // the board lookup ran — one re-read before latching a miss.
        const reread = await loadSealedText(window.localStorage, TRIALS_KEY, auth.uid);
        const late = loadTrials(reread.text).find(
          (entry) => entry.proposalId === proposalId,
        );
        if (late !== undefined) {
          challenge = trialChallenge(late);
        }
      }
      if (!aliveRef.current) {
        return;
      }
      if (challenge !== undefined) {
        setToteTaskId("");
        pickRotation(challenge);
        return;
      }
      rotationMissed.current = wanted;
      appliedChallenge.current = null;
    }
    void resolveTrial();
  }, [auth.uid, pickRotation]);
  // No open play: with unlocks in and nothing real picked, the
  // console arms the given trial itself — the next unified play,
  // or the first unlocked tote for a bare pack link. Skips while a
  // verdict stands (auto-advance owns that motion), while a link
  // honor is landing, and once any real pick clears the auto mark.
  useEffect(() => {
    if (unlocked.length === 0) {
      return;
    }
    if (result !== null || toteResult !== null) {
      return;
    }
    if (activeChallenge !== undefined && challengeId === "" && toteTaskId === "") {
      return;
    }
    const selected = toteTaskId !== "" ? toteTaskId : challengeId;
    if (selected !== "" && selected !== autoId.current) {
      return;
    }
    const params = parsePlayParams(window.location.search);
    if (
      params.challenge !== undefined &&
      unlocked.some((entry) => entry.id === params.challenge)
    ) {
      return;
    }
    // A rotation link claimed above is resolving (or already
    // armed): never arm the chain over somebody's created trial.
    if (
      params.challenge !== undefined &&
      parseRotationId(params.challenge) !== null &&
      appliedChallenge.current === params.challenge
    ) {
      return;
    }
    // A drill link owns the form too (drills are always open).
    if (params.challenge !== undefined && isDrillChallenge(params.challenge)) {
      return;
    }
    if (params.game === "tote" && params.challenge === undefined) {
      const toteTrial = unlocked.find((entry) => entry.kind === "tote");
      if (toteTrial !== undefined) {
        pickTask(toteTrial.id);
        autoId.current = toteTrial.id;
        return;
      }
    }
    const next = nextUnifiedPlay(completions) ?? unlocked[0];
    if (next !== undefined && next.id !== selected) {
      pickTask(next.id);
      autoId.current = next.id;
    }
  });
  const { setStats } = useMoonVisual();
  // Record strip: matches, bests, and cleared trials publish to the
  // left visual panel while signed in; the gate clears it.
  const bestImpact =
    matches.length === 0
      ? null
      : Math.max(...matches.map((entry) => entry.impact ?? 0));
  const bestEfficiency =
    matches.length === 0
      ? null
      : Math.max(...matches.map((entry) => entry.efficiency ?? 0));
  const clearedCount = Object.keys(completions).length;
  useEffect(() => {
    if (!signedIn) {
      setStats(null);
      return () => {
        setStats(null);
      };
    }
    setStats(
      <MoonStats
        matches={matches.length}
        bestImpact={bestImpact}
        bestEfficiency={bestEfficiency}
        cleared={clearedCount}
      />,
    );
    return () => {
      setStats(null);
    };
  }, [setStats, signedIn, matches.length, bestImpact, bestEfficiency, clearedCount]);
  // Armed tote tasks record like city trials: the verdict renders
  // in the pack section, the clear seals here. The pack score rides
  // the impact field normalized to the unified 0-100 scale, raw
  // beside it; bests compare across both shifts.
  const toteResult = tote.result;
  const toteModel = tote.model;
  useEffect(() => {
    if (toteTask === undefined || toteResult?.invalid_reason !== null) {
      return;
    }
    if (!challengePassed(evaluateToteChallenge(toteTask, toteResult))) {
      return;
    }
    recordClear(
      toteTask.id,
      toteNorm100(toteResult.score),
      0,
      toteModel,
      toteResult.score,
    );
  }, [toteTask, toteResult, toteModel, recordClear]);
  // The verdict binds to the task the pack ran under, not the live
  // picker — auto-advance moves the form on while it stands.
  const [packedTask, setPackedTask] = useState<Challenge | undefined>(undefined);
  const prevToteResult = useRef(toteResult);
  useEffect(() => {
    if (toteResult !== prevToteResult.current) {
      prevToteResult.current = toteResult;
      if (toteResult !== null) {
        setPackedTask(toteTask);
      }
    }
  });
  // First clears bring up the next challenge on their own: the
  // chain plays forward without touching the picker. Re-clears and
  // manual picks of old trials stay put (see nextPickAfterClear).
  const prevCompletionIds = useRef<string[] | null>(null);
  useEffect(() => {
    const ids = Object.keys(completions);
    const prev = prevCompletionIds.current;
    prevCompletionIds.current = ids;
    if (prev === null) {
      return;
    }
    const selected = toteTaskId !== "" ? toteTaskId : challengeId;
    const nextId = nextPickAfterClear(completions, prev, selected);
    if (nextId !== null) {
      pickTask(nextId, true);
    }
  }, [completions, challengeId, toteTaskId, pickTask]);
  // Left visual panel: every viewport and graph plays left, driven
  // by the right panel's scroll — the result's stage, the
  // aftermath deep-dive, the history charts, the pack crane. Text,
  // tables, and forms stay right. Memoized: map identity
  // re-publishes fresh content.
  const [showFull, setShowFull] = useState(false);
  const fullCompare = useMemo(
    () =>
      result === null
        ? undefined
        : recorded.find((entry) => entry.seed === result.seed),
    [result, recorded],
  );
  // Custom dressing reaches the stage from the run's own trial
  // snapshot — verdicts keep their look after auto-advance — and
  // the demo city previews the active city trial before the run.
  const stageAssets =
    resultChallenge?.assets ??
    (activeChallenge?.kind === "city" ? activeChallenge.assets : null) ??
    null;
  const spyVisuals = useMemo(
    () => ({
      result:
        signedIn && result !== null ? (
          <div className="arena-sim">
            <CityCanvas
              key={runId}
              result={result}
              prompt={prompt}
              assets={stageAssets}
              selectedTurn={selectedTurn}
              onTurnChange={setActiveTurn}
              onSelectTurn={setSelectedTurn}
            />
            {selectedTurn !== null && (
              <TurnInspect
                result={result}
                turn={selectedTurn}
                onClose={() => {
                  setSelectedTurn(null);
                }}
              />
            )}
          </div>
        ) : null,
      aftermath:
        signedIn && result !== null && showFull ? (
          <AnalyticsDashboard
            results={fullCompare === undefined ? [result] : [result, fullCompare]}
            flagTurns={buildCoaching(result).flagTurns}
            craftEntries={craftEntries}
          />
        ) : null,
      history:
        signedIn && recorded.length > 0 ? (
          <>
            <PromptVersionGraph entries={matches} />
            <AnalyticsDashboard results={recorded} craftEntries={craftEntries} />
          </>
        ) : null,
      pack:
        signedIn && toteResult !== null ? (
          <ToteCanvas
            key={tote.packId}
            catalog={tote.catalog}
            result={toteResult}
            prompt={tote.prompt}
          />
        ) : null,
    }),
    [
      signedIn,
      result,
      runId,
      prompt,
      stageAssets,
      selectedTurn,
      setActiveTurn,
      setSelectedTurn,
      showFull,
      fullCompare,
      recorded,
      matches,
      toteResult,
      tote.packId,
      tote.catalog,
      tote.prompt,
    ],
  );
  // Default stage: the left panel always plays the simulation —
  // the live run once it exists, the looping demo city before that.
  // Scroll sections (result, deep-dive, history) override it while
  // visible; everywhere else — the form, the top of the page — the
  // simulation is the view.
  const stageFallback = useMemo(
    () =>
      signedIn ? (
        <div className="arena-sim">
          <CityCanvas
            key={result === null ? "demo" : runId}
            result={result ?? DEMO_RESULT}
            prompt={result === null ? DEMO_PROMPT : prompt}
            assets={stageAssets}
            loop={result === null}
            selectedTurn={selectedTurn}
            onTurnChange={setActiveTurn}
            onSelectTurn={setSelectedTurn}
          />
          {selectedTurn !== null && (
            <TurnInspect
              result={result ?? DEMO_RESULT}
              turn={selectedTurn}
              onClose={() => {
                setSelectedTurn(null);
              }}
            />
          )}
        </div>
      ) : null,
    [
      signedIn,
      result,
      runId,
      prompt,
      stageAssets,
      selectedTurn,
      setActiveTurn,
      setSelectedTurn,
    ],
  );
  useVisualSpy(spyVisuals, stageFallback);

  return (
    <main className="console-page">
      <PlanetPanel enabled>
        <div className="shell">
          {!signedIn && (
            <SigninGate
              headingId="console-signin-heading"
              title="Sign in to run"
              hint="Sign in to open the console. Sessions stay on this machine."
            />
          )}

          {signedIn && (
            <>
              <NavPanel />
              <div className="shell-main" ref={setMainNode}>
                <header className="top" data-highlight>
                  <PageHeader words={["Operator", "console"]} highlightTitle />
                  {contractError !== null ? (
                    <p className="error" role="alert">
                      {contractError}
                    </p>
                  ) : null}
                </header>

                {mode !== null && (
                  <p className="mode-switch">
                    <Button
                      variant="ghost"
                      size="small"
                      onClick={() => {
                        selectMode(mode === "play" ? "create" : "play");
                      }}
                    >
                      {mode === "play"
                        ? "Create a challenge instead"
                        : "Simulate instead"}
                    </Button>
                  </p>
                )}
                {mode === null ? (
                  <section className="mode-gate" aria-labelledby="mode-gate-heading">
                    <h2 id="mode-gate-heading">What do you want to do?</h2>
                    <div className="mode-cards">
                      <button
                        type="button"
                        className="mode-card"
                        onClick={() => {
                          selectMode("play");
                        }}
                      >
                        <strong>Simulate a trial</strong>
                        <span>
                          Play the chain: city crises and tote pack-outs, scored and
                          ranked.
                        </span>
                      </button>
                      <button
                        type="button"
                        className="mode-card"
                        onClick={() => {
                          selectMode("create");
                        }}
                      >
                        <strong>Create a challenge</strong>
                        <span>
                          Propose the next arena trial; ranked bots vote the best ones
                          in.
                        </span>
                      </button>
                    </div>
                  </section>
                ) : mode === "play" ? (
                  <>
                    <div className="console-play">
                      <section
                        className="submit"
                        aria-labelledby="submit-heading"
                        data-highlight
                      >
                        <h2 id="submit-heading" data-highlight-title>
                          {isToteMode ? "Pack the tote" : "Submit a prompt"}
                        </h2>
                        <p className="section-sub">
                          {isToteMode
                            ? "The pack-out you're given. Fixed seed, fixed limits — call the stacking order."
                            : "The trial you're given. Two shocks, one steward — fixed seed, fixed limits."}
                        </p>
                        <ChainStrip completions={completions} onGoTo={goToChallenge} />
                        <ChallengePicker
                          value={toteTaskId !== "" ? toteTaskId : challengeId}
                          unlocked={unlocked}
                          completions={completions}
                          onPick={pickTask}
                          drills={DRILLS}
                        />
                        {isToteMode ? (
                          <ToteSubmit
                            tote={tote}
                            focusField={toteFocus}
                            onFocused={() => {
                              setToteFocus(null);
                            }}
                            challenge={toteTask}
                          />
                        ) : (
                          <>
                            <TaskCard
                              challenge={activeChallenge}
                              words={cap}
                              tokenBudget={budget}
                              seedText={seedText}
                              showStory
                            />
                            <label htmlFor="prompt">System prompt for the agent</label>
                            <textarea
                              id="prompt"
                              rows={10}
                              value={prompt}
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
                            <PromptCraft prompt={prompt} challenge={activeChallenge} />
                            <DepartmentBrief />
                            <label htmlFor="seed">
                              Seed (same seed replays the same city)
                            </label>
                            <input
                              id="seed"
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
                            {activeChallenge !== undefined && (
                              <p className="hint">
                                Seed locked to {activeChallenge.seed} by the challenge.
                              </p>
                            )}
                            <label htmlFor="chaos">
                              Chaos ({chaos}% — Fourier noise on terrain and shocks)
                            </label>
                            <input
                              id="chaos"
                              type="range"
                              min={0}
                              max={100}
                              step={5}
                              value={chaos}
                              onChange={(event) => {
                                setChaos(Number(event.target.value));
                              }}
                            />
                            <p className="hint">
                              {chaos === 0
                                ? "0% replays the legacy world exactly."
                                : `Same seed, wilder world — ${String(chaos)}% perturbs starting terrain and shock exposure.`}
                            </p>
                            <label htmlFor="variety">
                              <input
                                id="variety"
                                type="checkbox"
                                checked={variety}
                                onChange={(event) => {
                                  setVariety(event.target.checked);
                                }}
                              />
                              Run 3 variants — same prompt, best run counts
                            </label>
                            <p className="hint">
                              The challenged seed stays locked; the three runs vary
                              chaos (0/50/100%).
                            </p>
                            <label htmlFor="model">Model (who plays the turns)</label>
                            <select
                              id="model"
                              value={model}
                              disabled={
                                contract === null || contract.models.length === 0
                              }
                              onChange={(event) => {
                                setModel(event.target.value);
                              }}
                            >
                              {(contract?.models ?? []).map((entry) => {
                                const allowance = limitsForModel(entry.id, entry.kind);
                                return (
                                  <option key={entry.id} value={entry.id}>
                                    {entry.id} — {kindLabel(entry.kind)}
                                    {allowance === null
                                      ? ""
                                      : ` · ${allowanceLabel(allowance)}`}
                                  </option>
                                );
                              })}
                            </select>
                            <p className="hint">
                              Local runtimes connect themselves: LM Studio and Ollama
                              models appear here on their own (both stock ports are
                              probed) once the runtime is running — refocus this window
                              after starting one. Hosted models run on your key,
                              encrypted on this device — never on a host key.
                            </p>
                            <RunButton
                              running={running}
                              startedAt={progress?.startedAt ?? null}
                              idleLabel="Run match"
                              busyLabel={runBusyLabel(progress, variety)}
                              disabled={!canRun}
                              tourAnchor="run-button"
                              onRun={() => {
                                void runMatch();
                              }}
                            />
                            {error !== null && (
                              <p className="error" role="alert">
                                {error}
                              </p>
                            )}
                          </>
                        )}
                      </section>

                      {!isToteMode && (
                        <FieldPlanPanel
                          plan={plan}
                          onChange={setPlan}
                          disabled={running}
                          idPrefix="console"
                        />
                      )}

                      {result !== null && (
                        <section
                          className="result"
                          aria-labelledby="result-heading"
                          data-highlight
                          data-visual="result"
                        >
                          <h2 id="result-heading" data-highlight-title>
                            Result
                          </h2>
                          <p className="section-sub">
                            What the run scored — and where it could have gone
                            differently.
                          </p>
                          <>
                            <p className="match-meta">
                              Seed {result.seed} · {result.provider} ·{" "}
                              {formatTokensWithThinking(
                                result.totals.tokens_used ?? 0,
                                result.totals.thinking_tokens ?? 0,
                              )}{" "}
                              tokens · {(result.totals.spend ?? 0).toLocaleString()}{" "}
                              spent
                              <CostChip
                                tokens={trueTokenTotal(
                                  result.totals.tokens_used ?? 0,
                                  result.totals.thinking_tokens ?? 0,
                                )}
                                model={model}
                              />
                            </p>
                            <div className="arena">
                              <div className="arena-side arena-scores">
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
                                    {Object.entries(result.scores).map(
                                      ([name, value]) => (
                                        <tr key={name}>
                                          <th scope="row">{name}</th>
                                          <td className="num">{value.toFixed(2)}</td>
                                        </tr>
                                      ),
                                    )}
                                  </tbody>
                                </table>
                              </div>
                              <div className="arena-side arena-loss">
                                <h3>Loss reasons</h3>
                                <ul className="tight">
                                  {result.loss_reasons.map((reason) => (
                                    <li key={reason}>{reason}</li>
                                  ))}
                                </ul>
                              </div>
                            </div>
                            {resultChallenge !== undefined && (
                              <ChallengeAftermath
                                challenge={resultChallenge}
                                result={result}
                                prompt={prompt}
                                onJudge={() => {
                                  void handleJudge();
                                }}
                                judging={judging}
                                judgeVerdict={judgeVerdict}
                                judgeMeta={judgeMeta}
                                judgeError={judgeError}
                                checks={checks}
                                cleared={cleared}
                                best={completions[resultChallenge.id]}
                                completions={completions}
                                onRetryPrompt={retryWithPrompt}
                                onRetryModel={retryWithModel}
                                variants={variants}
                                boardPosition={boardPosition}
                                showFull={showFull}
                                onToggleFull={() => {
                                  setShowFull((value) => !value);
                                  // The dashboard plays in the left panel
                                  // when the verdict is in view — bring it
                                  // there so the toggle visibly does
                                  // something from anywhere on the page.
                                  document
                                    .querySelector('[data-visual="aftermath"]')
                                    ?.scrollIntoView({ block: "nearest" });
                                }}
                                onGoTo={goToChallenge}
                              />
                            )}
                            <TurnRules highlight={selectedTurn ?? activeTurn} />
                            {result.environment !== undefined && (
                              <EnvironmentPanel environment={result.environment} />
                            )}
                          </>
                        </section>
                      )}
                      <ToteResult tote={tote} verdictChallenge={packedTask} />
                      <ChallengesPanel
                        completions={completions}
                        focus={focusPick}
                        onPlay={(id) => {
                          pickTask(id);
                          document.getElementById("challenge")?.focus();
                        }}
                      />
                    </div>

                    <section
                      className="history"
                      aria-labelledby="history-heading"
                      data-highlight
                      data-visual="history"
                    >
                      <h2 id="history-heading" data-highlight-title>
                        This browser&apos;s matches
                      </h2>
                      <p className="section-sub">
                        Runs recorded on this device, newest first.
                      </p>
                      {craft !== null && (
                        <p className="hint">
                          Your structured prompts (craft ≥ {craft.threshold},{" "}
                          {craft.highCount} runs) average {craft.highAvg.toFixed(1)}{" "}
                          impact vs {craft.lowAvg.toFixed(1)} below ({craft.lowCount}{" "}
                          runs) — your own evidence for the checklist.
                        </p>
                      )}
                      {matches.length === 0 ? (
                        <p className="empty">
                          Nothing recorded yet. History stays in this browser only.
                        </p>
                      ) : (
                        <>
                          <table>
                            <thead>
                              <tr>
                                <th scope="col">When</th>
                                <th scope="col" className="num">
                                  Seed
                                </th>
                                <th scope="col">Provider</th>
                                <th scope="col" className="num">
                                  Impact
                                </th>
                                <th scope="col" className="num">
                                  Efficiency
                                </th>
                                <th scope="col" className="num">
                                  Δ vs prev same seed
                                </th>
                              </tr>
                            </thead>
                            <tbody>
                              {matches.map((entry, index) => {
                                const previous = matches
                                  .slice(index + 1)
                                  .find((other) => other.seed === entry.seed);
                                const delta =
                                  previous === undefined
                                    ? null
                                    : (entry.impact ?? 0) - (previous.impact ?? 0);
                                return (
                                  <tr
                                    key={`${entry.when}-${String(entry.seed)}`}
                                    title={
                                      entry.prompt === "" ? undefined : entry.prompt
                                    }
                                  >
                                    <td>{entry.when}</td>
                                    <td className="num">{entry.seed}</td>
                                    <td>{entry.provider}</td>
                                    <td className="num">
                                      {(entry.impact ?? 0).toFixed(2)}
                                    </td>
                                    <td className="num">
                                      {(entry.efficiency ?? 0).toFixed(2)}
                                    </td>
                                    <td className="num">
                                      {delta === null
                                        ? "—"
                                        : `${delta >= 0 ? "+" : ""}${delta.toFixed(2)}`}
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                          <p className="hint">
                            History resets live on the{" "}
                            <a href={link("account")}>Account page</a> — the console
                            keeps no reset controls of its own.
                          </p>
                        </>
                      )}
                    </section>
                    <DatasetsPanel uid={auth.uid} />
                    <section
                      className="recovery"
                      aria-labelledby="session-section"
                      data-highlight
                    >
                      <h2 id="session-section" data-highlight-title>
                        Session
                      </h2>
                      {!auth.durable && (
                        <p className="notice" role="status">
                          Storage is blocked here — your session lasts until you leave,
                          and nothing is saved.
                        </p>
                      )}
                      <p className="hint">
                        Your arena ID, recovery, progress transfer, and sign-out live on
                        the <a href={link("account")}>Account page</a>.
                      </p>
                    </section>
                  </>
                ) : (
                  <section
                    className="create"
                    aria-labelledby="create-heading"
                    data-highlight
                  >
                    <h2 id="create-heading" data-highlight-title>
                      Create a challenge
                    </h2>
                    <p className="section-sub">
                      Propose the next arena trial. Ranked bots vote with their record
                      behind them — fresh ids earn a voice by playing first.
                    </p>
                    <CreatorPanel
                      uid={auth.uid}
                      nickname={readBotNickname()}
                      models={contract?.models ?? []}
                      history={historyApi.history}
                      onSimulateTrial={(challenge) => {
                        autoId.current = null;
                        setToteTaskId("");
                        pickRotation(challenge);
                        selectMode("play");
                      }}
                    />
                  </section>
                )}
              </div>
            </>
          )}
        </div>
      </PlanetPanel>
    </main>
  );
}
