"use client";

import { useEffect, useState } from "react";
import { COMPLETIONS_KEY, loadCompletions } from "@/lib/challenges";
import type { Completion } from "@/lib/challenges";
import { loadSealedText } from "@/lib/sealed-store";
import { getOrCreateUid } from "@/lib/vault";

/**
 * Cleared trials from the same sealed store the console writes:
 * legacy plaintext reads instantly, sealed envelopes open under
 * the arena ID. `loaded` flips once the sealed read lands, so
 * callers can defer locked-vs-unlocked decisions past the flash
 * of empty. Blocked storage reads empty and stays honest.
 */
export function useCompletions(): {
  completions: Record<string, Completion>;
  loaded: boolean;
} {
  const [completions, setCompletions] = useState<Record<string, Completion>>(() =>
    loadCompletions(),
  );
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    let live = true;
    let uid: string;
    try {
      uid = getOrCreateUid();
    } catch {
      return () => {
        live = false;
      };
    }
    void loadSealedText(window.localStorage, COMPLETIONS_KEY, uid).then((read) => {
      if (!live) {
        return;
      }
      setCompletions(loadCompletions(read.text));
      setLoaded(true);
    });
    return () => {
      live = false;
    };
  }, []);
  return { completions, loaded };
}
