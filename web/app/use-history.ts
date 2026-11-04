"use client";

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { COMPLETIONS_KEY } from "@/lib/challenges";
import { HISTORY_KEY, loadHistory } from "@/lib/history";
import type { HistoryEntry } from "@/lib/history";
import { getStoreSnapshot, subscribeStore } from "@/lib/match-run-store";
import { loadSealedText } from "@/lib/sealed-store";
import { safeRemoveItem } from "@/lib/safe-storage";
import { getOrCreateUid } from "@/lib/vault";

/** Shared run-history store: one list for matches and packs, one writer. */
export interface HistoryApi {
  history: HistoryEntry[];
  clearHistory: () => void;
  reloadHistory: () => void;
}

export function useHistory(): HistoryApi {
  const [history, setHistory] = useState<HistoryEntry[]>([]);

  const reloadHistory = useCallback((): void => {
    void loadSealedText(window.localStorage, HISTORY_KEY, getOrCreateUid()).then(
      (read) => {
        setHistory(loadHistory(read.text));
      },
    );
  }, []);

  // Runs settle into the sealed store from the background run
  // store — even with no console mounted. The bump reloads this
  // list on mount and after every settle.
  const historyBump = useSyncExternalStore(
    subscribeStore,
    () => getStoreSnapshot().historyBump,
    () => getStoreSnapshot().historyBump,
  );

  useEffect(() => {
    reloadHistory();
  }, [reloadHistory, historyBump]);

  function clearHistory(): void {
    safeRemoveItem(HISTORY_KEY);
    // Completions are history-derived (clears, bests, unlocks): a
    // history wipe that left them behind would keep showing cleared
    // trials and best scores the player just deleted.
    safeRemoveItem(COMPLETIONS_KEY);
    setHistory([]);
  }

  return { history, clearHistory, reloadHistory };
}
