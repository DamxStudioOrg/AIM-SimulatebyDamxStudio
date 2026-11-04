"use client";

import { useRouter } from "next/navigation";
import { buildConsoleLink, buildToteLink } from "@/lib/console-link";
import { entryGame } from "@/lib/history";
import type { HistoryEntry } from "@/lib/history";
import BatchAblation from "../batch-ablation";
import { useMoonTitle } from "../moon-visual";

/**
 * Batch ablation is parked for now: the queue stays mounted only
 * when explicitly enabled, so prompts ships without it by default.
 * Set NEXT_PUBLIC_SHOW_BATCH_ABLATION=1 and rebuild to bring it back.
 */
const SHOW_BATCH_ABLATION = process.env.NEXT_PUBLIC_SHOW_BATCH_ABLATION === "1";
import PageHeader from "../page-header";
import PromptsPanel from "../prompts-panel";
import RouteShell from "../route-shell";
import { useHistory } from "../use-history";

/** Prompt history: replay, edit, or clear past runs. */
export default function PromptsPage(): React.ReactElement {
  // Idle left panel: a detail visual overrides while one is in
  // view; otherwise the title stands in. The gate shows it too.
  useMoonTitle("Prompt history");
  const historyApi = useHistory();
  const router = useRouter();

  function openEntry(entry: HistoryEntry): void {
    if (entryGame(entry) === "tote") {
      router.push(buildToteLink({ prompt: entry.prompt, seed: String(entry.seed) }));
      return;
    }
    router.push(buildConsoleLink({ prompt: entry.prompt, seed: String(entry.seed) }));
  }

  function replayEntry(entry: HistoryEntry): boolean {
    openEntry(entry);
    return true;
  }

  return (
    <RouteShell
      gateHeadingId="prompts-signin-heading"
      gateTitle="Sign in to run"
      gateHint="Sign in to open your prompts. Sessions stay on this machine."
    >
      <PageHeader words={["Prompt", "history"]} />
      <PromptsPanel
        entries={historyApi.history}
        onReplay={replayEntry}
        onEdit={openEntry}
        onClear={historyApi.clearHistory}
      />
      {/* Gated: batch ablation is parked — see SHOW_BATCH_ABLATION. */}
      {SHOW_BATCH_ABLATION && <BatchAblation />}
    </RouteShell>
  );
}
