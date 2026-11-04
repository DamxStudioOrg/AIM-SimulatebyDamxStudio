/**
 * Batch ablation runner with real runs via useMatch.
 * Runs multiple prompt variants across seeds and collects results.
 */

import { useState } from "react";
import { useHistory } from "./use-history";
import { useMatch } from "./use-match";
import { downloadCsv, exportTurnCsv, toCsv } from "@/lib/csv-export";
import { Button } from "@/components/base/buttons/button";
import { ProgressBar } from "@/components/base/progress/progress";
import type { CsvRow } from "@/lib/csv-export";

interface VariantResult {
  prompt: string;
  seed: string;
  status: "pending" | "running" | "done" | "error";
  runId?: string;
  impact?: number;
  efficiency?: number;
}

export default function BatchAblationRunner(): React.ReactElement {
  const historyApi = useHistory();
  const match = useMatch(historyApi);
  const [prompts, setPrompts] = useState(
    "Prioritize housing before shock, then rescue\nPrioritize green first, then housing",
  );
  const [seeds, setSeeds] = useState("1,2");
  const [log, setLog] = useState<string[]>([]);
  const [isRunning, setIsRunning] = useState(false);
  const [cancelled, setCancelled] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [resultsMap, setResultsMap] = useState<Record<string, VariantResult>>({});

  const pList = prompts
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
  const sList = seeds
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  const runBatch = async (): Promise<void> => {
    const total = pList.length * sList.length;
    setIsRunning(true);
    setCancelled(false);
    setProgress({ done: 0, total });
    setLog([`Starting batch: ${String(total)} runs`]);
    const results: { prompt: string; seed: string; runId: string }[] = [];
    const map: Record<string, VariantResult> = {};
    pList.forEach((p, i) => {
      for (const s of sList) {
        map[`${String(i)}-${s}`] = { prompt: p, seed: s, status: "pending" };
      }
    });
    setResultsMap(map);
    let done = 0;
    for (let i = 0; i < pList.length; i++) {
      const p = pList[i] ?? "";
      for (const s of sList) {
        if (cancelled) {
          setLog((l) => [...l, "Batch cancelled"]);
          break;
        }
        const key = `${String(i)}-${s}`;
        setResultsMap((m) => ({
          ...m,
          [key]: { ...(m[key] ?? { prompt: p, seed: s }), status: "running" },
        }));
        setLog((l) => [...l, `Running prompt: ${p.slice(0, 30)}... seed ${s}`]);
        match.setPrompt(p);
        match.setSeedText(s);
        await new Promise<void>((resolve) => {
          window.setTimeout(resolve, 0);
        });
        try {
          await match.runMatch();
        } catch (e) {
          setResultsMap((m) => ({
            ...m,
            [key]: { ...(m[key] ?? { prompt: p, seed: s }), status: "error" },
          }));
          setLog((l) => [...l, `Error running seed ${s}: ${String(e)}`]);
          done++;
          setProgress({ done, total });
          continue;
        }
        await new Promise<void>((resolve) => {
          window.setTimeout(resolve, 150);
        });
        const latest = historyApi.history[0];
        if (latest?.prompt === p && String(latest.seed) === s) {
          results.push({ prompt: p, seed: s, runId: latest.when });
          setResultsMap((m) => ({
            ...m,
            [key]: {
              prompt: p,
              seed: s,
              status: "done",
              runId: latest.when,
              impact: latest.impact,
              efficiency: latest.efficiency,
            },
          }));
          setLog((l) => [
            ...l,
            `Done seed ${s} → impact ${(latest.impact ?? 0).toFixed(2)} efficiency ${(latest.efficiency ?? 0).toFixed(2)}`,
          ]);
        } else {
          setResultsMap((m) => ({
            ...m,
            [key]: { ...(m[key] ?? { prompt: p, seed: s }), status: "error" },
          }));
          setLog((l) => [...l, `Done seed ${s} (no matching history entry)`]);
        }
        done++;
        setProgress({ done, total });
      }
      if (cancelled) break;
    }
    setIsRunning(false);
    setLog((l) => [...l, `Batch complete. ${String(results.length)} runs collected.`]);
    if (results.length > 0) {
      const compareRows: CsvRow[] = [];
      for (const r of results) {
        const entry = historyApi.history.find((e) => e.when === r.runId);
        const res = entry?.result;
        if (entry !== undefined && res !== undefined && "turns" in res) {
          compareRows.push({
            run_id: r.runId,
            provider: entry.provider,
            seed: entry.seed,
            prompt_preview: r.prompt.slice(0, 80),
            prompt_variant: pList.indexOf(r.prompt) + 1,
            impact: res.scores.impact ?? 0,
            efficiency: res.scores.efficiency ?? 0,
            tokens_used: res.totals.tokens_used ?? 0,
            turn_rows: exportTurnCsv(res, r.runId).split("\n").length - 1,
          });
        }
      }
      downloadCsv(toCsv(compareRows), `batch-ablation-${String(Date.now())}.csv`);
      setLog((l) => [...l, "Exported batch-ablation CSV"]);
    }
  };

  return (
    <section className="batch-ablation-runner">
      <h3>Batch ablation runner</h3>
      <label htmlFor="batch-prompts">Prompts (one per line)</label>
      <textarea
        id="batch-prompts"
        value={prompts}
        onChange={(e) => {
          setPrompts(e.target.value);
        }}
        rows={6}
      />
      <label htmlFor="batch-seeds">Seeds (comma separated)</label>
      <input
        id="batch-seeds"
        value={seeds}
        onChange={(e) => {
          setSeeds(e.target.value);
        }}
      />
      <div className="actions">
        <Button
          variant="primary"
          size="medium"
          onClick={() => {
            void runBatch();
          }}
          disabled={isRunning}
        >
          Run batch
        </Button>
        {isRunning && (
          <Button
            variant="ghost"
            size="medium"
            onClick={() => {
              setCancelled(true);
              setIsRunning(false);
            }}
          >
            Cancel
          </Button>
        )}
      </div>
      {progress.total > 0 && (
        <div className="batch-progress">
          <ProgressBar
            value={progress.done}
            maxValue={progress.total}
            label={`${progress.done}/${progress.total} runs`}
          />
        </div>
      )}
      {Object.keys(resultsMap).length > 0 && (
        <div className="variant-results">
          <h4>Per-variant results</h4>
          <table>
            <thead>
              <tr>
                <th>Variant</th>
                <th>Seed</th>
                <th>Status</th>
                <th>Impact</th>
                <th>Efficiency</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {pList.map((p, i) =>
                sList.map((s) => {
                  const key = `${String(i)}-${s}`;
                  const r = resultsMap[key];
                  return (
                    <tr key={key}>
                      <td title={p}>{p.slice(0, 40)}</td>
                      <td>{s}</td>
                      <td>{r?.status ?? "pending"}</td>
                      <td>{r?.impact?.toFixed(2) ?? "-"}</td>
                      <td>{r?.efficiency?.toFixed(2) ?? "-"}</td>
                      <td>
                        {r?.status === "error" && (
                          <Button
                            variant="secondary"
                            size="small"
                            onClick={() => {
                              setLog((l) => [
                                ...l,
                                `Retrying ${p.slice(0, 20)} seed ${s}`,
                              ]);
                              match.setPrompt(p);
                              match.setSeedText(s);
                              void match.runMatch().then(() => {
                                setLog((l) => [...l, "Retry done"]);
                              });
                            }}
                          >
                            Retry
                          </Button>
                        )}
                      </td>
                    </tr>
                  );
                }),
              )}
            </tbody>
          </table>
          <p className="hint">
            Prompt Version Graph auto-updates in My Prompts as runs complete.
          </p>
        </div>
      )}
      <pre className="log">{log.join("\n")}</pre>
    </section>
  );
}
