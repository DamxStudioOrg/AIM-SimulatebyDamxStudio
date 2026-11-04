"use client";

import { useEffect, useState } from "react";
import type { ModelInfo } from "@/lib/sim";

/**
 * Contract model list for routes without the run form (create,
 * connect): id/kind pairs for model pickers and key cards. Empty
 * until the sim answers; panels handle the empty state.
 */
export function useContractModels(): ModelInfo[] {
  const [models, setModels] = useState<ModelInfo[]>([]);
  useEffect(() => {
    let cancelled = false;
    fetch("/api/contract")
      .then(async (response) => {
        const body: unknown = await response.json();
        if (cancelled || !response.ok) {
          return;
        }
        const list: unknown = (body as { models?: unknown }).models;
        if (!Array.isArray(list)) {
          return;
        }
        setModels(
          list.filter(
            (entry): entry is ModelInfo =>
              typeof entry === "object" &&
              entry !== null &&
              typeof (entry as { id?: unknown }).id === "string" &&
              ((entry as { kind?: unknown }).kind === "local" ||
                (entry as { kind?: unknown }).kind === "hosted"),
          ),
        );
      })
      .catch(() => {
        // Sim unreachable: callers render their empty state.
      });
    return () => {
      cancelled = true;
    };
  }, []);
  return models;
}
