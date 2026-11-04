/**
 * CSV export utilities for researchers.
 * Exports per-turn metrics for model comparison and prompt ablation.
 */
import type { MatchResultPayload, MatchTurn } from "./sim";

export type CsvRow = Record<string, string | number>;

const ALLOCATION_KEYS = [
  "housing",
  "transit",
  "health",
  "green",
  "reserves",
  "rescue",
  "shelter",
  "repair",
] as const;

export function toCsv(rows: CsvRow[]): string {
  if (rows.length === 0) return "";
  const first = rows[0];
  if (first === undefined) return "";
  const headers = Object.keys(first);
  const escape = (v: string | number): string => {
    const s = String(v);
    if (s.includes(",") || s.includes('"') || s.includes("\n")) {
      return `"${s.replace(/"/g, '""')}"`;
    }
    return s;
  };
  const headerLine = headers.join(",");
  const dataLines = rows.map((r) => headers.map((h) => escape(r[h] ?? "")).join(","));
  return [headerLine, ...dataLines].join("\n");
}

export function exportTurnCsv(result: MatchResultPayload, runId: string): string {
  const rows: CsvRow[] = result.turns.map((t: MatchTurn) => {
    const row: CsvRow = {
      run_id: runId,
      provider: result.provider,
      turn: t.turn,
      impact: t.impact ?? "",
      efficiency: t.efficiency ?? "",
      tokens_used: t.tokens_used,
      thinking_tokens: t.thinking_tokens ?? 0,
      spend: t.spend,
      skip_reason: t.skip_reason ?? "",
    };
    for (const key of ALLOCATION_KEYS) {
      row[`allocation_${key}`] = t.allocation?.[key] ?? "";
    }
    return row;
  });
  return toCsv(rows);
}

export function downloadCsv(csv: string, filename: string): void {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function exportDeltaCsv(
  resultA: MatchResultPayload,
  resultB: MatchResultPayload,
  runIdA: string,
  runIdB: string,
): string {
  const rows: CsvRow[] = [];
  for (const t of resultA.turns) {
    const tb = resultB.turns.find((x) => x.turn === t.turn);
    if (tb === undefined) continue;
    const allocA = t.allocation ?? {};
    const allocB = tb.allocation ?? {};
    for (const key of ALLOCATION_KEYS) {
      rows.push({
        run_id_a: runIdA,
        run_id_b: runIdB,
        turn: t.turn,
        metric: `alloc_${key}_diff`,
        value: (allocA[key] ?? 0) - (allocB[key] ?? 0),
      });
    }
    rows.push({
      run_id_a: runIdA,
      run_id_b: runIdB,
      turn: t.turn,
      metric: "impact_diff",
      value: (t.impact ?? 0) - (tb.impact ?? 0),
    });
    rows.push({
      run_id_a: runIdA,
      run_id_b: runIdB,
      turn: t.turn,
      metric: "efficiency_diff",
      value: (t.efficiency ?? 0) - (tb.efficiency ?? 0),
    });
  }
  return toCsv(rows);
}
