"use client";

import { Button } from "@/components/base/buttons/button";
import { UNIFIED_CHAIN, nextUnifiedPlay, type Completion } from "@/lib/challenges";

export interface ChainStripProps {
  completions: Record<string, Completion>;
  onGoTo: (id: string) => void;
}

/**
 * Console chain strip: cleared count plus the next trial in unified
 * order with its kind tag. No fixed total — endless replays continue
 * after the chain itself is done.
 */
export default function ChainStrip({
  completions,
  onGoTo,
}: ChainStripProps): React.JSX.Element {
  const cleared = UNIFIED_CHAIN.filter(
    (entry) => completions[entry.id] !== undefined,
  ).length;
  const next = nextUnifiedPlay(completions);
  return (
    <p className="chain-strip">
      Chain — {cleared} cleared
      {next === undefined ? (
        <> · chain done, endless replays continue below</>
      ) : (
        <>
          {" · "}next: {next.kind === "city" ? "City" : "Tote"} — {next.title}{" "}
          <Button
            variant="ghost"
            size="small"
            onClick={() => {
              onGoTo(next.id);
            }}
          >
            Play it
          </Button>
        </>
      )}
    </p>
  );
}
