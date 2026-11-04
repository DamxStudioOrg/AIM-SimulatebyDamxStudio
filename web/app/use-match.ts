"use client";

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import {
  clearSession,
  getStoreSnapshot,
  presentMatchReplay,
  startMatchRun,
  subscribeStore,
} from "@/lib/match-run-store";
import type { RunProgressState } from "@/lib/match-run-store";
import { fetchSimCall } from "@/lib/direct-sim";
import { isOffline } from "@/lib/online";
import {
  CHALLENGES,
  COMPLETIONS_KEY,
  challengePassed,
  clearedChallengeIds,
  challengeById,
  evaluateChallenge,
  isDrillChallenge,
  isEndlessUnlocked,
  isUnifiedUnlocked,
  loadCompletions,
  rankWordBonus,
  unifiedImpact,
  unifiedUnlocked,
} from "@/lib/challenges";
import type { ChallengeAssets } from "@/lib/asset-schema";
import { parseChallengeAssets } from "@/lib/asset-schema";
import type { Challenge, Completion } from "@/lib/challenges";
import type { FieldIntervention } from "@/lib/field-plan";
import type { HistoryEntry } from "@/lib/history";
import { parseRotationId } from "@/lib/leagues";
import { effectiveLimits, limitsForModel } from "@/lib/model-limits";
import { loadSealedText, sealText } from "@/lib/sealed-store";
import { safeGetItem, safeSetItem } from "@/lib/safe-storage";
import type { MatchResultPayload, SimContract } from "@/lib/sim";
import { fetchBoard } from "@/lib/server-board";
import {
  META_PROVIDER_ID,
  getOrCreateUid,
  loadProviderKey,
  tokenKeyForModel,
} from "@/lib/vault";
import { countWords } from "@/lib/words";
import { buildVariants } from "@/lib/variants";
import type { VariantRun } from "@/lib/variants";
import type { HistoryApi } from "./use-history";

const MODEL_KEY = "aim-arena-model";
const CHALLENGE_KEY = "aim-arena-challenge";

/** Live position inside a running match; null while idle. */
export type RunProgress = RunProgressState;

export function kindLabel(kind: string): string {
  if (kind === "local") {
    return "local runtime";
  }
  if (kind === "hosted") {
    return "hosted key";
  }
  return "offline";
}

/**
 * Shared match-playing state for the arena shell and the operator console.
 * One hook, one behavior: prompt form, match runner, challenges. Run
 * history lives in the shared store passed in, beside tote packs.
 */
export function useMatch(historyApi: HistoryApi): {
  contract: SimContract | null;
  contractError: string | null;
  prompt: string;
  setPrompt: (value: string) => void;
  seedText: string;
  setSeedText: (value: string) => void;
  model: string;
  setModel: (value: string) => void;
  challengeId: string;
  completions: Record<string, Completion>;
  unlocked: Challenge[];
  rankBonus: number;
  rankPosition: number | null;
  running: boolean;
  /** Live position inside the running match; null while idle. */
  progress: RunProgress | null;
  result: MatchResultPayload | null;
  replayWhen: string | null;
  replayEntry: (entry: HistoryEntry) => boolean;
  runId: number;
  activeTurn: number;
  setActiveTurn: (value: number) => void;
  selectedTurn: number | null;
  setSelectedTurn: (value: number | null) => void;
  plan: FieldIntervention[];
  setPlan: (value: FieldIntervention[]) => void;
  chaos: number;
  setChaos: (value: number) => void;
  variety: boolean;
  setVariety: (value: boolean) => void;
  variants: VariantRun[] | null;
  assets: ChallengeAssets | null;
  setAssets: (value: ChallengeAssets | null) => void;
  resultAssets: ChallengeAssets | null;
  error: string | null;
  history: HistoryEntry[];
  words: number;
  cap: number;
  budget: number;
  overCap: boolean;
  seedValid: boolean;
  canRun: boolean;
  runMatch: () => Promise<void>;
  boardPosition: number | null;
  activeChallenge: (typeof CHALLENGES)[number] | undefined;
  /** Challenge the standing result ran under; survives picker moves. */
  resultChallenge: (typeof CHALLENGES)[number] | undefined;
  checks: ReturnType<typeof evaluateChallenge>;
  cleared: boolean;
  pickChallenge: (id: string, keepResult?: boolean) => void;
  pickRotation: (challenge: Challenge) => void;
  dismissResult: () => void;
  recordClear: (
    id: string,
    impact: number,
    efficiency: number,
    model: string,
    raw?: number,
  ) => void;
} {
  const [contract, setContract] = useState<SimContract | null>(null);
  const [contractError, setContractError] = useState<string | null>(null);
  const [prompt, setPrompt] = useState("");
  const [seedText, setSeedText] = useState("1");
  const [model, setModel] = useState("");
  const [challengeId, setChallengeId] = useState("");
  const [rotation, setRotation] = useState<Challenge | null>(null);
  const [completions, setCompletions] = useState<Record<string, Completion>>({});
  // The run itself lives in the background store, so it survives
  // navigation: this hook adopts the live session on mount and
  // mirrors it. Only pre-run failures (offline, missing key) stay
  // local — nothing has started yet to publish them.
  const session = useSyncExternalStore(
    subscribeStore,
    () => getStoreSnapshot().match,
    () => getStoreSnapshot().match,
  );
  const [localError, setLocalError] = useState<string | null>(null);
  const running = session.status === "running";
  const progress = session.progress;
  const result = session.result;
  const resultChallenge = session.challenge;
  const variants: VariantRun[] | null = session.variants;
  const resultAssets = session.resultAssets;
  const runId = session.token;
  const boardPosition = session.boardPosition;
  const error = localError ?? session.error;
  const [plan, setPlan] = useState<FieldIntervention[]>([]);
  const [chaos, setChaos] = useState(0);
  const [variety, setVariety] = useState(false);
  const [assets, setAssets] = useState<ChallengeAssets | null>(null);
  const [replayWhen, setReplayWhen] = useState<string | null>(null);
  const [activeTurn, setActiveTurn] = useState(1);
  const [selectedTurn, setSelectedTurn] = useState<number | null>(null);
  const [rankPosition, setRankPosition] = useState<number | null>(null);

  // A fresh verdict (settled or replayed) rewinds the turn lens.
  useEffect(() => {
    setSelectedTurn(null);
    setActiveTurn(1);
  }, [runId]);

  useEffect(() => {
    let live = true;
    void loadSealedText(window.localStorage, COMPLETIONS_KEY, getOrCreateUid()).then(
      (read) => {
        if (!live) {
          return;
        }
        const stored = loadCompletions(read.text);
        setCompletions(stored);
        const savedChallenge = safeGetItem(CHALLENGE_KEY);
        if (savedChallenge !== null && savedChallenge !== "") {
          const cleared = clearedChallengeIds(stored);
          const picked = challengeById(savedChallenge);
          if (picked !== undefined && isUnifiedUnlocked(picked.id, cleared)) {
            setChallengeId(picked.id);
            setSeedText(String(picked.seed));
          }
        }
      },
    );
    const saved = safeGetItem(MODEL_KEY);
    if (saved !== null && saved !== "") {
      setModel(saved);
    }
    const fetchContract = (): void => {
      fetchSimCall({ path: "/api/contract" }, { path: "/contract" })
        .then(async (response) => {
          const body: unknown = await response.json();
          if (!response.ok) {
            const hint =
              typeof body === "object" && body !== null
                ? (body as Record<string, unknown>).hint
                : undefined;
            setContractError(
              typeof hint === "string"
                ? `Sim API is unreachable. ${hint}`
                : "Sim API is unreachable. Start it, then reload this page.",
            );
            return;
          }
          setContract(body as SimContract);
          setContractError(null);
        })
        .catch(() => {
          setContractError("Sim API is unreachable. Start it, then reload this page.");
        });
    };
    fetchContract();
    const onOnline = (): void => {
      fetchContract();
    };
    // Auto-connect: a local runtime started after page load (LM
    // Studio finished loading a model) only enters the contract —
    // and so the model dropdown — on a refetch. Coming back to the
    // window is the natural moment; the sim re-probes runtimes per
    // contract call, so the new models simply appear.
    const onFocus = (): void => {
      fetchContract();
    };
    window.addEventListener("online", onOnline);
    window.addEventListener("focus", onFocus);
    return () => {
      live = false;
      window.removeEventListener("online", onOnline);
      window.removeEventListener("focus", onFocus);
    };
  }, []);

  const clearedIds = clearedChallengeIds(completions);
  const unlocked = unifiedUnlocked(clearedIds);
  const found = challengeById(challengeId);
  const activeChallenge =
    rotation ??
    (found !== undefined &&
    (isUnifiedUnlocked(found.id, clearedIds) ||
      isEndlessUnlocked(found.id, clearedIds) ||
      isDrillChallenge(found.id))
      ? found
      : undefined);
  const rankBonus =
    activeChallenge !== undefined && parseRotationId(activeChallenge.id) !== null
      ? 0
      : rankWordBonus(rankPosition);
  const words = countWords(prompt);
  const modelKind = contract?.models.find((entry) => entry.id === model)?.kind;
  const modelAllowance = limitsForModel(model, modelKind);
  const taskLimits = effectiveLimits({
    challenge: activeChallenge,
    model: modelAllowance,
    contract: contract ?? undefined,
  });
  const cap = taskLimits.words + rankBonus;
  const budget = taskLimits.tokenBudget;
  const overCap = words > cap;
  const seed = Number.parseInt(seedText, 10);
  const seedValid = Number.isInteger(seed);
  const canRun =
    !running && !overCap && seedValid && words > 0 && contract !== null && model !== "";

  useEffect(() => {
    let live = true;
    async function refreshRank(): Promise<void> {
      let uid: string;
      try {
        uid = getOrCreateUid();
      } catch {
        return;
      }
      const board = await fetchBoard("city", "impact", {
        uid,
        ...(challengeId === "" ? {} : { challenge: challengeId }),
      });
      if (live) {
        setRankPosition(board?.you?.position ?? null);
      }
    }
    void refreshRank();
    return () => {
      live = false;
    };
  }, [challengeId, boardPosition]);

  useEffect(() => {
    if (contract === null || contract.models.length === 0) {
      return;
    }
    const listed = contract.models.some((entry) => entry.id === model);
    if (!listed) {
      const first = contract.models[0]?.id ?? "";
      setModel(first);
      try {
        window.localStorage.setItem(MODEL_KEY, first);
      } catch {
        // A blocked store must not break model selection.
      }
    }
  }, [contract, model]);

  async function runMatch(): Promise<void> {
    if (isOffline()) {
      setLocalError("You're offline — reconnect to run a match.");
      return;
    }
    const uid = getOrCreateUid();
    let providerKey: string | undefined;
    if (modelKind === "hosted") {
      const tokenKey = tokenKeyForModel(model);
      try {
        providerKey = (await loadProviderKey(tokenKey)) ?? undefined;
      } catch {
        providerKey = undefined;
      }
      if (providerKey === undefined) {
        setLocalError(
          tokenKey === META_PROVIDER_ID
            ? "Add your Meta API token under Connect a bot first."
            : `Add your own key for "${model}" under Connect a bot first.`,
        );
        return;
      }
    }
    setLocalError(null);
    setReplayWhen(null);
    const caps: { promptMaxWords?: number; tokenBudget?: number } =
      activeChallenge === undefined && rankBonus === 0 && modelAllowance === null
        ? {}
        : {
            promptMaxWords: cap,
            tokenBudget: budget,
          };
    const challengeParams =
      activeChallenge === undefined
        ? undefined
        : {
            kind: activeChallenge.kind,
            id: activeChallenge.id,
            seed: activeChallenge.seed,
            goals: activeChallenge.goals,
          };
    const specs = variety
      ? buildVariants({
          seed,
          chaos,
          challenged: activeChallenge !== undefined,
        })
      : [
          {
            label: "",
            seed,
            chaosLevel: chaos > 0 ? chaos / 100 : undefined,
          },
        ];
    // The store owns the run from here: progress, settle, history,
    // and board receipt all publish back through the session this
    // hook mirrors — and keep publishing with no console mounted.
    await startMatchRun({
      prompt,
      seed,
      model,
      uid,
      providerKey,
      promptMaxWords: caps.promptMaxWords,
      tokenBudget: caps.tokenBudget,
      interventions: plan,
      challengeParams,
      challenge: activeChallenge,
      specs,
      turnsTotal: contract?.turns ?? 0,
      assets,
    });
  }

  function replayEntry(entry: HistoryEntry): boolean {
    if (entry.result === undefined || !("turns" in entry.result)) {
      return false;
    }
    setPrompt(entry.prompt);
    setSeedText(String(entry.seed));
    setPlan(entry.plan ?? []);
    // Stored dressing is untrusted JSON: re-parse, drop on any failure.
    const stored = parseChallengeAssets(entry.assets ?? null);
    const dressed = stored.ok ? stored.value : null;
    setAssets(dressed);
    // Replays carry no challenge id: no verdict binds to them. The
    // store presents the replay (and rewinds the turn lens via the
    // new token); nothing settles, boards, or notifies.
    presentMatchReplay(entry.result, dressed);
    setReplayWhen(entry.when);
    setLocalError(null);
    return true;
  }

  // Checks bind to the run's own challenge, not the live picker —
  // auto-advance moves the form on while the verdict stands.
  const checks =
    resultChallenge === undefined || result === null
      ? []
      : evaluateChallenge(resultChallenge, result);
  const cleared = challengePassed(checks);

  /**
   * Record a cleared task (city trial or tote pack-out): best unified
   * score wins per id, sealed under the arena ID. Callers pass
   * already-validated clears — this keeps books, not verdicts. New
   * clears stamp their kind (and tote raw packs); legacy tote clears
   * normalize on comparison so an old perfect pack keeps its crown.
   */
  const recordClear = useCallback(
    (
      id: string,
      impact: number,
      efficiency: number,
      clearedModel: string,
      raw?: number,
    ): void => {
      const kind = challengeById(id)?.kind;
      setCompletions((previous) => {
        const best = previous[id];
        if (best !== undefined && unifiedImpact(id, best) >= impact) {
          return previous;
        }
        const next: Record<string, Completion> = {
          ...previous,
          [id]: {
            when: new Date().toISOString(),
            impact,
            efficiency,
            model: clearedModel,
            ...(kind === undefined ? {} : { kind }),
            ...(raw === undefined ? {} : { raw }),
          },
        };
        void sealText(
          window.localStorage,
          COMPLETIONS_KEY,
          getOrCreateUid(),
          JSON.stringify(next),
        );
        return next;
      });
    },
    [],
  );

  useEffect(() => {
    if (
      result === null ||
      resultChallenge === undefined ||
      !cleared ||
      parseRotationId(resultChallenge.id) !== null
    ) {
      return;
    }
    recordClear(
      resultChallenge.id,
      result.scores.impact ?? 0,
      result.scores.efficiency ?? 0,
      model,
    );
  }, [result, resultChallenge, cleared, model, runId, recordClear]);

  /** Clear a finished run so the aftermath can offer retry/next. */
  function dismissResult(): void {
    setLocalError(null);
    clearSession("match");
    setReplayWhen(null);
    setSelectedTurn(null);
  }

  function pickChallenge(id: string, keepResult = false): void {
    // Tote picks belong to the console's pack-out form, never this id.
    if (id !== "" && challengeById(id)?.kind === "tote") {
      return;
    }
    const clearedNow = clearedChallengeIds(completions);
    if (
      id !== "" &&
      !isUnifiedUnlocked(id, clearedNow) &&
      !isEndlessUnlocked(id, clearedNow) &&
      !isDrillChallenge(id)
    ) {
      return;
    }
    // Auto-advance keeps the standing verdict while the form moves on.
    if (!keepResult) {
      dismissResult();
    }
    setRotation(null);
    setChallengeId(id);
    safeSetItem(CHALLENGE_KEY, id);
    setAssets(null);
    const picked = challengeById(id);
    if (picked !== undefined) {
      setSeedText(String(picked.seed));
      // Drills open with their draft in place (the flawed prompt
      // to fix); picking the drill again restores it.
      if (picked.starterPrompt !== undefined) {
        setPrompt(picked.starterPrompt);
      }
    }
  }

  /** Load a featured community trial; the chain unlock order is untouched. */
  function pickRotation(challenge: Challenge): void {
    setRotation(challenge);
    setChallengeId("");
    safeSetItem(CHALLENGE_KEY, "");
    setSeedText(String(challenge.seed));
    setAssets(challenge.assets ?? null);
  }

  function setModelAndSave(value: string): void {
    setModel(value);
    try {
      window.localStorage.setItem(MODEL_KEY, value);
    } catch {
      // A blocked store must not break model selection.
    }
  }

  return {
    contract,
    contractError,
    prompt,
    setPrompt,
    seedText,
    setSeedText,
    model,
    setModel: setModelAndSave,
    challengeId,
    completions,
    unlocked,
    rankBonus,
    rankPosition,
    running,
    progress,
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
    chaos,
    setChaos,
    variety,
    setVariety,
    variants,
    assets,
    setAssets,
    resultAssets,
    error,
    history: historyApi.history,
    words,
    cap,
    budget,
    overCap,
    seedValid,
    canRun,
    runMatch,
    boardPosition,
    activeChallenge,
    resultChallenge,
    checks,
    cleared,
    pickChallenge,
    pickRotation,
    dismissResult,
    recordClear,
  };
}

export type MatchApi = ReturnType<typeof useMatch>;
