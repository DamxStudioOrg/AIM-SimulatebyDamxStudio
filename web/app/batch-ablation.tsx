/**
 * Batch ablation queue preview for systematic prompt testing.
 * Lists the variant × seed combinations the real runner will play;
 * metrics only ever come from actual runs, never generated here.
 */

import { useState } from "react";
import { Button } from "@/components/base/buttons/button";

export default function BatchAblation(): React.ReactElement {
  const [prompts, setPrompts] = useState(
    "Prompt variant A\nPrompt variant B\nPrompt variant C",
  );
  const [seeds, setSeeds] = useState("1,2,3");
  const [results, setResults] = useState<string>("");

  const run = (): void => {
    const pList = prompts
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);
    const sList = seeds
      .split(",")
      .map((s) => Number.parseInt(s.trim(), 10))
      .filter((n) => !Number.isNaN(n));
    const rows = ["variant,seed,status"];
    pList.forEach((_p, i) => {
      for (const s of sList) {
        rows.push(`${String(i + 1)},${String(s)},queued`);
      }
    });
    setResults(rows.join("\n"));
  };

  const download = (): void => {
    const blob = new Blob([results], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "batch-ablation-queue.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <section className="batch-ablation">
      <h3>Batch ablation queue</h3>
      <p>
        Test multiple prompt variants across seeds. Results are deterministic per seed +
        prompt + model, and are collected by the batch runner from real matches.
      </p>
      <label htmlFor="ablation-prompts">Prompts (one per line)</label>
      <textarea
        id="ablation-prompts"
        value={prompts}
        onChange={(e) => {
          setPrompts(e.target.value);
        }}
        rows={6}
      />
      <label htmlFor="ablation-seeds">Seeds (comma separated)</label>
      <input
        id="ablation-seeds"
        value={seeds}
        onChange={(e) => {
          setSeeds(e.target.value);
        }}
      />
      <div className="actions">
        <Button variant="primary" onClick={run}>
          Preview queue
        </Button>
        <Button variant="secondary" onClick={download} disabled={results === ""}>
          Download CSV
        </Button>
      </div>
      {results !== "" && <pre className="preview">{results}</pre>}
    </section>
  );
}
