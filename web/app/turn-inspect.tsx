"use client";

import { useState } from "react";
import { Button } from "@/components/base/buttons/button";
import { interventionLabel } from "@/lib/field-plan";
import { formatTokensWithThinking } from "@/lib/pricing";
import { TURN_RULES } from "@/lib/rules";
import type { MatchResultPayload, WhatIfResult } from "@/lib/sim";

const ALLOCATION_ORDER = [
  "housing",
  "transit",
  "health",
  "green",
  "reserves",
  "rescue",
  "shelter",
  "repair",
];

interface TurnInspectProps {
  result: MatchResultPayload;
  turn: number;
  onClose: () => void;
}

const WHAT_IF_POINTS = 10;

export default function TurnInspect({
  result,
  turn,
  onClose,
}: TurnInspectProps): React.ReactElement {
  const [target, setTarget] = useState("rescue");
  const [preview, setPreview] = useState<WhatIfResult | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const log = result.turns[turn - 1];
  const rule = TURN_RULES[turn - 1];
  if (log === undefined || rule === undefined) {
    return (
      <div className="inspect" role="status">
        <p>No replay data for turn {turn}.</p>
        <Button variant="ghost" size="small" onClick={onClose}>
          Resume replay
        </Button>
      </div>
    );
  }

  const status =
    log.skip_reason === null
      ? `Played${log.policies.length > 0 ? ` · ${log.policies.join(", ")}` : " · no policies"}`
      : `Skipped (${log.skip_reason})`;
  const fired =
    typeof log.intervention === "string" && log.intervention !== ""
      ? interventionLabel(log.intervention)
      : null;
  const running =
    typeof log.impact === "number" && typeof log.efficiency === "number"
      ? `Impact ${log.impact.toFixed(2)} · Efficiency ${log.efficiency.toFixed(2)}`
      : null;

  return (
    <div
      className="inspect"
      role="status"
      aria-label={`Turn ${String(turn)} inspection`}
    >
      <div className="inspect-head">
        <h3>
          Turn {turn} ·{" "}
          <span className={`phase phase-${rule.phase}`}>{rule.phase}</span>
        </h3>
        <Button variant="ghost" size="small" onClick={onClose}>
          Resume replay
        </Button>
      </div>
      <p className="rule-event">{rule.event}</p>
      <dl className="inspect-facts">
        <div>
          <dt>Tokens</dt>
          <dd>{formatTokensWithThinking(log.tokens_used, log.thinking_tokens)}</dd>
        </div>
        <div>
          <dt>Spend</dt>
          <dd>${log.spend.toLocaleString("en-US")}</dd>
        </div>
        <div>
          <dt>Status</dt>
          <dd>{status}</dd>
        </div>
        {fired !== null && (
          <div>
            <dt>Field plan</dt>
            <dd>{fired} fired this turn</dd>
          </div>
        )}
        {running !== null && (
          <div>
            <dt>Running</dt>
            <dd>{running}</dd>
          </div>
        )}
      </dl>
      {log.allocation === null ? (
        <p className="hint">
          No allocation reached the sim — a skipped turn runs on fumes while a live
          crisis still bleeds.
        </p>
      ) : (
        <>
          <div className="what-if">
            <label htmlFor={`what-if-target-${String(turn)}`}>
              What if this turn moved {WHAT_IF_POINTS} points to
            </label>
            <select
              id={`what-if-target-${String(turn)}`}
              value={target}
              onChange={(event) => {
                setTarget(event.target.value);
                setPreview(null);
              }}
            >
              {ALLOCATION_ORDER.map((key) => (
                <option key={key} value={key}>
                  {key}
                </option>
              ))}
            </select>
            <Button
              variant="secondary"
              size="small"
              disabled={previewing}
              onClick={() => {
                void (async () => {
                  const current = log.allocation;
                  if (current === null) return;
                  const source = ALLOCATION_ORDER.filter((key) => key !== target).sort(
                    (a, b) => (current[b] ?? 0) - (current[a] ?? 0),
                  )[0];
                  if (source === undefined) return;
                  const moved = Math.min(WHAT_IF_POINTS, current[source] ?? 0);
                  if (moved <= 0) return;
                  const allocation = {
                    ...current,
                    [source]: (current[source] ?? 0) - moved,
                    [target]: (current[target] ?? 0) + moved,
                  };
                  setPreviewing(true);
                  setPreviewError(null);
                  try {
                    const response = await fetch("/api/what-if", {
                      method: "POST",
                      headers: { "content-type": "application/json" },
                      body: JSON.stringify({
                        seed: result.seed,
                        allocations: result.turns.map((entry) => entry.allocation),
                        turn,
                        allocation,
                      }),
                    });
                    if (!response.ok) throw new Error("preview failed");
                    setPreview((await response.json()) as WhatIfResult);
                  } catch {
                    setPreviewError("What-if preview unavailable right now.");
                  } finally {
                    setPreviewing(false);
                  }
                })();
              }}
            >
              {previewing ? "Previewing…" : "Preview"}
            </Button>
            {preview !== null && (
              <p className="hint" role="status">
                Impact would move {preview.impact_delta >= 0 ? "+" : ""}
                {preview.impact_delta.toFixed(2)} (from{" "}
                {(preview.baseline.impact ?? 0).toFixed(2)} to{" "}
                {(preview.variant.impact ?? 0).toFixed(2)}).
              </p>
            )}
            {previewError !== null && (
              <p className="error" role="alert">
                {previewError}
              </p>
            )}
          </div>
        </>
      )}
      {log.allocation === null ? null : (
        <ul className="alloc-bars">
          {ALLOCATION_ORDER.map((key) => {
            const pct = log.allocation?.[key] ?? 0;
            return (
              <li key={key}>
                <span className="alloc-name">{key}</span>
                <span className="bar" aria-hidden="true">
                  <span style={{ width: `${pct.toFixed(1)}%` }} />
                </span>
                <span className="num">{pct.toFixed(0)}%</span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
