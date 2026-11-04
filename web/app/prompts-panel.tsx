"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/base/buttons/button";
import { useVisualSpy } from "./use-visual-spy";
import gsap from "gsap";
import AllocationHeatmap from "./allocation-heatmap";
import AllocationDiffHeatmap from "./allocation-diff-heatmap";
import AnalyticsDashboard from "./analytics-dashboard";
import ResearcherNotes from "./researcher-notes";
import PromptVersionGraph from "./prompt-version-graph";
import { entryGame, formatHistoryWhen } from "@/lib/history";
import type { HistoryEntry } from "@/lib/history";
import { diffStats, promptDiff } from "@/lib/prompt-diff";

const EXCERPT_CHARS = 140;

function scoreText(entry: HistoryEntry): string {
  if (entryGame(entry) === "tote") {
    return `Score ${(entry.score ?? 0).toFixed(1)} · Damage ${(entry.damage ?? 0).toFixed(1)}`;
  }
  return `Impact ${(entry.impact ?? 0).toFixed(1)} · Efficiency ${(entry.efficiency ?? 0).toFixed(1)}`;
}

function excerpt(prompt: string): string {
  if (prompt.length <= EXCERPT_CHARS) {
    return prompt;
  }
  return `${prompt.slice(0, EXCERPT_CHARS)}…`;
}

function Timeline({ entry }: Readonly<{ entry: HistoryEntry }>): React.ReactElement {
  const beats = [
    { title: "Prompted", body: formatHistoryWhen(entry.when) },
    {
      title: "Played",
      body: `Seed ${String(entry.seed)} · ${entry.model === undefined || entry.model === "" ? entry.provider : entry.model}`,
    },
    {
      title: "Scored",
      body: scoreText(entry),
    },
    {
      title: "Ranked",
      body:
        entry.boardPosition === undefined || entry.boardPosition === null
          ? "Board unreachable — rank unknown"
          : `Live board #${String(entry.boardPosition)}`,
    },
  ];
  return (
    <ol className="timeline">
      {beats.map((beat) => (
        <li key={beat.title}>
          <strong>{beat.title}</strong>
          <span>{beat.body}</span>
        </li>
      ))}
    </ol>
  );
}

/** Signed-in dashboard: your prompts, their outputs, replay, and rerun. */
export default function PromptsPanel({
  entries,
  onReplay,
  onEdit,
  onClear,
}: Readonly<{
  entries: HistoryEntry[];
  onReplay: (entry: HistoryEntry) => boolean;
  onEdit: (entry: HistoryEntry) => void;
  onClear: () => void;
}>): React.ReactElement {
  const [selectedWhen, setSelectedWhen] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const detailRef = useRef<HTMLElement | null>(null);
  const selected = entries.find((entry) => entry.when === selectedWhen) ?? null;
  // Left visual panel: the detail's graphs play left while the run
  // detail is in view; prompt text, diff, journey, and notes stay
  // right. Memoized: map identity re-publishes fresh content.
  const detailVisuals = useMemo(() => {
    if (selected === null) {
      return { "prompt-detail": null };
    }
    const index = entries.findIndex((entry) => entry.when === selected.when);
    const prevResult = entries[index + 1]?.result;
    const turns =
      selected.result !== undefined && "turns" in selected.result
        ? selected.result.turns
        : null;
    const prevTurns =
      prevResult !== undefined && "turns" in prevResult ? prevResult.turns : null;
    const recorded = entries.flatMap((entry) => {
      const candidate = entry.result;
      return candidate !== undefined && "turns" in candidate ? [candidate] : [];
    });
    return {
      "prompt-detail": (
        <>
          <PromptVersionGraph entries={entries} />
          {turns !== null && (
            <>
              <h4>Where the spend went</h4>
              <AllocationHeatmap turns={turns} />
              {prevTurns !== null && (
                <AllocationDiffHeatmap turnsA={turns} turnsB={prevTurns} />
              )}
            </>
          )}
          <AnalyticsDashboard
            results={recorded}
            activeId={`${selected.provider}-seed${String(selected.seed)}`}
          />
        </>
      ),
    };
  }, [entries, selected]);
  useVisualSpy(detailVisuals);

  useEffect(() => {
    const node = detailRef.current;
    if (node === null) {
      return;
    }
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      return;
    }
    const tween = gsap.from(node, {
      y: 16,
      opacity: 0,
      duration: 0.4,
      ease: "power3.out",
    });
    return () => {
      tween.kill();
    };
  }, [selectedWhen]);

  if (entries.length === 0) {
    return (
      <section aria-labelledby="prompts-heading">
        <h2 id="prompts-heading">My prompts</h2>
        <p className="hint">
          No prompts yet — your runs land here with their scores and replays.
        </p>
        <p className="cta-row">
          <a className="button" href="#play">
            Run your first match
          </a>
        </p>
      </section>
    );
  }

  return (
    <>
      <section aria-labelledby="prompts-heading">
        <h2 id="prompts-heading">My prompts</h2>
        {notice !== null && (
          <p className="notice" role="status">
            {notice}
          </p>
        )}
        <ul className="prompt-list">
          {entries.map((entry) => (
            <li key={entry.when}>
              <article aria-current={entry.when === selectedWhen ? "true" : undefined}>
                <p className="prompt-meta">
                  <span>{formatHistoryWhen(entry.when)}</span>
                  <span className="chip">
                    {entryGame(entry) === "tote" ? "Tote pack" : "City match"}
                  </span>
                  <span className="chip">Seed {entry.seed}</span>
                  <span className="chip">{entry.provider}</span>
                </p>
                <p className="prompt-scores">{scoreText(entry)}</p>
                <p className="prompt-text">{excerpt(entry.prompt)}</p>
                <p className="prompt-actions">
                  <Button
                    variant="ghost"
                    size="small"
                    onClick={() => {
                      setSelectedWhen(entry.when);
                    }}
                  >
                    {entry.when === selectedWhen ? "Hide detail" : "Show detail"}
                  </Button>{" "}
                  <Button
                    variant="secondary"
                    size="small"
                    disabled={entry.result === undefined}
                    title={
                      entry.result === undefined
                        ? "Saved before replays — rerun to record one"
                        : "Replay this run on the stage"
                    }
                    onClick={() => {
                      const ok = onReplay(entry);
                      setNotice(
                        ok
                          ? `Replaying the run from ${formatHistoryWhen(entry.when)} on the stage.`
                          : "No recording for this run — edit and rerun it to record one.",
                      );
                    }}
                  >
                    Replay
                  </Button>{" "}
                  <Button
                    variant="ghost"
                    size="small"
                    onClick={() => {
                      onEdit(entry);
                    }}
                  >
                    Edit &amp; rerun
                  </Button>
                </p>
              </article>
            </li>
          ))}
        </ul>
        <p>
          <Button variant="ghost" size="small" onClick={onClear}>
            Clear history
          </Button>
        </p>
      </section>
      {selected !== null && (
        <section
          ref={detailRef}
          aria-labelledby="prompt-detail-heading"
          className="prompt-detail"
          data-visual="prompt-detail"
        >
          <h3 id="prompt-detail-heading">
            Run detail — {formatHistoryWhen(selected.when)}
          </h3>
          <blockquote>{selected.prompt}</blockquote>
          {(() => {
            const index = entries.findIndex((entry) => entry.when === selected.when);
            const previous = index >= 0 ? entries[index + 1] : undefined;
            if (previous === undefined || previous.prompt === selected.prompt) {
              return null;
            }
            const segments = promptDiff(previous.prompt, selected.prompt);
            const stats = diffStats(segments);
            return (
              <>
                <h4>
                  Changes from the previous run (+{stats.added} / −{stats.removed}{" "}
                  words)
                </h4>
                <p className="prompt-diff">
                  {segments.map((segment, segmentIndex) =>
                    segment.kind === "same" ? (
                      <span key={segmentIndex}>{segment.text} </span>
                    ) : (
                      <span
                        key={segmentIndex}
                        className={
                          segment.kind === "added" ? "diff-added" : "diff-removed"
                        }
                      >
                        {segment.text}{" "}
                      </span>
                    ),
                  )}
                </p>
              </>
            );
          })()}
          <div className="detail-actions">
            <Button
              variant="ghost"
              size="small"
              onClick={() => {
                void navigator.clipboard.writeText(selected.prompt);
              }}
            >
              Copy prompt
            </Button>
            <Button
              variant="ghost"
              size="small"
              onClick={() => {
                onEdit(selected);
              }}
            >
              Edit & rerun
            </Button>
            <Button
              variant="ghost"
              size="small"
              onClick={() => {
                const payload = JSON.stringify({
                  prompt: selected.prompt,
                  seed: selected.seed,
                  provider: selected.provider,
                });
                void navigator.clipboard.writeText(payload);
              }}
            >
              Clone for ablation
            </Button>
          </div>
          <h4>Journey</h4>
          <Timeline entry={selected} />
          {selected.result === undefined ? (
            <p className="hint">
              No recording for this run — it was saved before replays. Edit and rerun it
              to record one.
            </p>
          ) : "turns" in selected.result ? (
            <>
              <ResearcherNotes runId={selected.when} />
            </>
          ) : (
            <>
              <h4>Packing order</h4>
              <p>{selected.result.packing.join(", ")}</p>
            </>
          )}
        </section>
      )}
    </>
  );
}
