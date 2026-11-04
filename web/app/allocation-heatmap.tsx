"use client";

import { useEffect, useMemo, useRef } from "react";
import { DPR_CAP, FONT } from "@/lib/replay-clock";
import {
  HEATMAP_THEME,
  SHOCK_TURNS,
  allocationGrid,
  gridSummary,
  heatColor,
} from "@/lib/allocation-grid";
import type { MatchTurn } from "@/lib/sim";

/* ------------------------------------------------------------------ */
/* Static allocation heatmap: rows are budget keys, columns are turns, */
/* cell heat is the share of that turn's spend. Shock columns flagged. */
/* Colors from HEATMAP_THEME in the lib; geometry constants below.    */
/* ------------------------------------------------------------------ */
const THEME = HEATMAP_THEME;

const LABEL_W = 76;
const HEAD_H = 22;
const CELL = 26;
const GAP = 4;
const PAD = 10;

/** Honest "attention" plot: where the prompt actually spent, per turn. */
export default function AllocationHeatmap({
  turns,
}: Readonly<{ turns: MatchTurn[] }>): React.ReactElement {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const grid = useMemo(() => allocationGrid(turns), [turns]);
  const summary = useMemo(() => gridSummary(grid), [grid]);
  const width = LABEL_W + turns.length * (CELL + GAP) + PAD * 2;
  const height = HEAD_H + grid.keys.length * (CELL + GAP) + PAD * 2;

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d") ?? null;
    if (canvas === null || ctx === null) {
      return;
    }
    const dpr = Math.min(window.devicePixelRatio || 1, DPR_CAP);
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = THEME.bg;
    ctx.fillRect(0, 0, width, height);
    ctx.font = `11px ${FONT}`;
    ctx.textBaseline = "middle";

    for (const [turnIndex] of turns.entries()) {
      const x = PAD + LABEL_W + turnIndex * (CELL + GAP);
      const isShock = SHOCK_TURNS.includes(turnIndex + 1);
      ctx.fillStyle = isShock ? THEME.shock : THEME.muted;
      ctx.fillText(String(turnIndex + 1), x + CELL / 2 - 3, PAD + HEAD_H / 2);
      if (isShock) {
        ctx.fillRect(x, PAD + HEAD_H - 4, CELL, 2);
      }
    }
    for (const [keyIndex, key] of grid.keys.entries()) {
      const y = PAD + HEAD_H + keyIndex * (CELL + GAP);
      ctx.fillStyle = THEME.muted;
      ctx.fillText(key, PAD, y + CELL / 2);
      const row = grid.cells[keyIndex] ?? [];
      for (const [turnIndex, share] of row.entries()) {
        const x = PAD + LABEL_W + turnIndex * (CELL + GAP);
        ctx.fillStyle = heatColor(share);
        ctx.fillRect(x, y, CELL, CELL);
        ctx.strokeStyle = THEME.edge;
        ctx.lineWidth = 1;
        ctx.strokeRect(x + 0.5, y + 0.5, CELL - 1, CELL - 1);
      }
    }
  }, [grid, height, turns, width]);

  return (
    <figure className="heatmap">
      <canvas ref={canvasRef} role="img" aria-label={summary} />
      <figcaption>{summary}</figcaption>
    </figure>
  );
}
