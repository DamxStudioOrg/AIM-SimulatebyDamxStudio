/** Normalized rows and captions for the ranks stage chart. */
import type { RankSnapshotRow, RanksSnapshot } from "./server-board";

export const CHART_ROWS = 8;

export interface ChartRow {
  position: number;
  name: string;
  value: number;
  /** 0..1 share of the chart's top value. */
  width01: number;
  you: boolean;
}

export function chartRows(snapshot: RanksSnapshot): ChartRow[] {
  const top = snapshot.rows.slice(0, CHART_ROWS);
  const max = top.reduce((peak, row) => Math.max(peak, row.value), 0);
  return top.map((row: RankSnapshotRow) => ({
    position: row.position,
    name: row.name,
    value: row.value,
    width01: max > 0 ? row.value / max : 0,
    you: row.you,
  }));
}

/** Plain-language caption of the chart for screen readers. */
export function rankSummary(snapshot: RanksSnapshot): string {
  const rows = chartRows(snapshot);
  if (rows.length === 0) {
    return "No runs on this board yet.";
  }
  const scope = `${snapshot.game} ${snapshot.metric}${snapshot.challenge === "" ? "" : `, ${snapshot.challenge}`}`;
  const leaders = rows
    .slice(0, 3)
    .map((row) => `${row.name} ${row.value.toFixed(1)}`)
    .join(", ");
  const yours = rows.find((row) => row.you);
  const tail = yours === undefined ? "" : ` You rank #${String(yours.position)}.`;
  return `Top ${String(rows.length)} ${scope}: ${leaders}.${tail}`;
}
