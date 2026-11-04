/** Per-turn allocation shares for the honest "attention" heatmap. */
import { CITY_KEYS } from "./city-scene";
import type { CityKey } from "./city-scene";
import type { MatchTurn } from "./sim";

/** Shock turns (1-based) the sim fires: flood, then heat. */
export const SHOCK_TURNS = [5, 9];

/**
 * Heatmap colors, mirroring the app/styles/base.css tokens (canvas cannot
 * read CSS vars): bg `--surface`, cold `--brand-line`, hot
 * `--brand-2`, text `--ink`, muted `--muted`, shock `--brand`,
 * edge `--surface-3`.
 */
export const HEATMAP_THEME = {
  bg: "#200a0a",
  cellCold: "#4a1515",
  cellHot: "#ffe64d",
  text: "#ffffff",
  muted: "rgba(255, 255, 255, 0.72)",
  shock: "#a33030",
  edge: "#2b0e0e",
} as const;

const HEAT_COLD: readonly [number, number, number] = [74, 21, 21];
const HEAT_HOT: readonly [number, number, number] = [255, 230, 77];

/** Cell fill for a 0..1 spend share: cold token at 0, hot at 1. */
export function heatColor(share: number): string {
  if (share <= 0) {
    return HEATMAP_THEME.cellCold;
  }
  const t = Math.min(share, 1);
  const mix = HEAT_COLD.map((c, index) =>
    Math.round(c + ((HEAT_HOT[index] ?? c) - c) * t),
  );
  return `rgb(${mix.join(",")})`;
}

export interface AllocationGrid {
  keys: readonly CityKey[];
  /** cells[keyIndex][turnIndex], each a 0..1 share of that turn's spend. */
  cells: number[][];
  max: number;
}

export function allocationGrid(turns: MatchTurn[]): AllocationGrid {
  const cells = CITY_KEYS.map((key) =>
    turns.map((turn) => {
      const allocation = turn.allocation;
      if (allocation === null) {
        return 0;
      }
      const total = CITY_KEYS.reduce((sum, entry) => sum + (allocation[entry] ?? 0), 0);
      if (total <= 0) {
        return 0;
      }
      return (allocation[key] ?? 0) / total;
    }),
  );
  const max = cells.reduce(
    (peak, row) => row.reduce((inner, cell) => Math.max(inner, cell), peak),
    0,
  );
  return { keys: CITY_KEYS, cells, max };
}

export interface GridPeak {
  key: CityKey;
  /** 1-based turn number. */
  turn: number;
  /** 0..1 share of that turn's spend. */
  share: number;
}

export function gridPeak(grid: AllocationGrid): GridPeak | null {
  let peak: GridPeak | null = null;
  for (const [keyIndex, key] of grid.keys.entries()) {
    const row = grid.cells[keyIndex] ?? [];
    for (const [turnIndex, share] of row.entries()) {
      if (peak === null || share > peak.share) {
        peak = { key, turn: turnIndex + 1, share };
      }
    }
  }
  return peak === null || peak.share <= 0 ? null : peak;
}

/** Plain-language summary of the grid for screen readers and captions. */
export function gridSummary(grid: AllocationGrid): string {
  const peak = gridPeak(grid);
  if (peak === null) {
    return "No recorded allocations: every turn was skipped.";
  }
  const percent = Math.round(peak.share * 100);
  return (
    `Peak spend: ${peak.key} ${String(percent)} percent at turn ${String(peak.turn)}. ` +
    `Flood shock at turn 5, heat shock at turn 9.`
  );
}
