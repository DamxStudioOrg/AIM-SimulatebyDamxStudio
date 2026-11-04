"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { fetchSimCall } from "@/lib/direct-sim";
import {
  getStoreSnapshot,
  presentPackReplay,
  startPackRun,
  subscribeStore,
} from "@/lib/match-run-store";
import { isOffline } from "@/lib/online";
import type { SimContract, ToteCatalog, ToteOffer, TotePackResult } from "@/lib/sim";
import {
  META_PROVIDER_ID,
  getOrCreateUid,
  loadProviderKey,
  tokenKeyForModel,
} from "@/lib/vault";
import { countWords } from "@/lib/words";
import type { HistoryEntry } from "@/lib/history";

/** Single-shot tote-packing state: offer preview, pack runner, board rank. */
export function useTote(): {
  contract: SimContract | null;
  contractError: string | null;
  catalog: ToteCatalog | null;
  offer: ToteOffer | null;
  offerError: string | null;
  prompt: string;
  setPrompt: (value: string) => void;
  seedText: string;
  setSeedText: (value: string) => void;
  model: string;
  setModel: (value: string) => void;
  running: boolean;
  /** Epoch ms the pack started; null while idle. Drives the elapsed readout. */
  startedAt: number | null;
  result: TotePackResult | null;
  replayWhen: string | null;
  replayEntry: (entry: HistoryEntry) => boolean;
  packId: number;
  error: string | null;
  boardPosition: number | null;
  words: number;
  cap: number;
  overCap: boolean;
  seedValid: boolean;
  canRun: boolean;
  packTote: () => Promise<void>;
} {
  const [contract, setContract] = useState<SimContract | null>(null);
  const [contractError, setContractError] = useState<string | null>(null);
  const [catalog, setCatalog] = useState<ToteCatalog | null>(null);
  const [offer, setOffer] = useState<ToteOffer | null>(null);
  const [offerError, setOfferError] = useState<string | null>(null);
  const [prompt, setPrompt] = useState("");
  const [seedText, setSeedText] = useState("1");
  const [model, setModel] = useState("");
  // The pack lives in the background store and mirrors back here,
  // so it survives navigation like matches do. Only pre-pack
  // failures stay local — nothing has started yet to publish them.
  const session = useSyncExternalStore(
    subscribeStore,
    () => getStoreSnapshot().pack,
    () => getStoreSnapshot().pack,
  );
  const [localError, setLocalError] = useState<string | null>(null);
  const running = session.status === "running";
  const startedAt = session.startedAt;
  const result = session.result;
  const packId = session.token;
  const boardPosition = session.boardPosition;
  const error = localError ?? session.error;
  const [replayWhen, setReplayWhen] = useState<string | null>(null);

  useEffect(() => {
    fetchSimCall({ path: "/api/contract" }, { path: "/contract" })
      .then(async (response) => {
        const body: unknown = await response.json();
        if (!response.ok) {
          setContractError("Sim API is unreachable. Start it, then reload this page.");
          return;
        }
        setContract(body as SimContract);
      })
      .catch(() => {
        setContractError("Sim API is unreachable. Start it, then reload this page.");
      });
    fetchSimCall({ path: "/api/tote?view=catalog" }, { path: "/tote/catalog" })
      .then(async (response) => {
        const body: unknown = await response.json();
        if (response.ok) {
          setCatalog(body as ToteCatalog);
        }
      })
      .catch(() => {
        // Catalog failure surfaces with the offer error below.
      });
  }, []);

  const seed = Number.parseInt(seedText, 10);
  const seedValid = Number.isInteger(seed);

  useEffect(() => {
    if (!seedValid) {
      setOffer(null);
      return;
    }
    let live = true;
    fetchSimCall(
      { path: `/api/tote?view=offer&seed=${String(seed)}` },
      { path: `/tote/offer?seed=${String(seed)}` },
    )
      .then(async (response) => {
        const body: unknown = await response.json();
        if (!live) {
          return;
        }
        if (!response.ok) {
          setOffer(null);
          setOfferError("Could not load this seed's offer.");
          return;
        }
        setOffer(body as ToteOffer);
        setOfferError(null);
      })
      .catch(() => {
        if (live) {
          setOffer(null);
          setOfferError("Could not load this seed's offer.");
        }
      });
    return () => {
      live = false;
    };
  }, [seed, seedValid]);

  const words = countWords(prompt);
  const cap = contract?.prompt_max_words ?? 250;
  const overCap = words > cap;
  const canRun =
    !running && !overCap && seedValid && words > 0 && contract !== null && model !== "";

  useEffect(() => {
    if (contract === null || contract.models.length === 0) {
      return;
    }
    const listed = contract.models.some((entry) => entry.id === model);
    if (!listed) {
      setModel(contract.models[0]?.id ?? "");
    }
  }, [contract, model]);

  async function packTote(): Promise<void> {
    if (isOffline()) {
      setLocalError("You're offline — reconnect to pack a tote.");
      return;
    }
    const uid = getOrCreateUid();
    const modelKind = contract?.models.find((entry) => entry.id === model)?.kind;
    let providerKey: string | undefined;
    if (modelKind === "hosted") {
      // Provider-level lookup: one Meta token unlocks every meta/*
      // model, like matches — never the per-model miss.
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
    // The store owns the pack from here and publishes the verdict
    // back — even with no console mounted.
    await startPackRun({ prompt, seed, model, uid, providerKey });
  }

  function replayEntry(entry: HistoryEntry): boolean {
    if (entry.result === undefined || !("packing" in entry.result)) {
      return false;
    }
    setPrompt(entry.prompt);
    setSeedText(String(entry.seed));
    presentPackReplay(entry.result);
    setReplayWhen(entry.when);
    setLocalError(null);
    return true;
  }

  return {
    contract,
    contractError,
    catalog,
    offer,
    offerError,
    prompt,
    setPrompt,
    seedText,
    setSeedText,
    model,
    setModel,
    running,
    startedAt,
    result,
    replayWhen,
    replayEntry,
    packId,
    error,
    boardPosition,
    words,
    cap,
    overCap,
    seedValid,
    canRun,
    packTote,
  };
}

export type ToteApi = ReturnType<typeof useTote>;
