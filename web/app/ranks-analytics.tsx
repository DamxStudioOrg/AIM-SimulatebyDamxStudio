"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { chartRows, rankSummary } from "@/lib/rank-chart";
import { DPR_CAP, FONT, STAGE_SQUARE } from "@/lib/replay-clock";
import { PALETTE3D, rankBars } from "@/lib/stage3d";
import type { RanksSnapshot } from "@/lib/server-board";
import { fitCamera, isoBox, line, project, shade, toCss } from "@/lib/iso";
import type { Ctx } from "@/lib/iso";
import { paintMoonDisc } from "@/lib/render-mcp";

/** Deterministic crater pattern under the analytics bars. */
const RANK_MOON_SEED = 7;

function label(
  ctx: Ctx,
  title: string,
  value: string,
  x: number,
  y: number,
  px: number,
): void {
  ctx.font = `700 ${String(px)}px ${FONT}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.lineWidth = Math.max(2, px / 4);
  ctx.strokeStyle = "rgba(20,8,10,0.85)";
  ctx.strokeText(title, x, y);
  ctx.fillStyle = "#ffffff";
  ctx.fillText(title, x, y);
  ctx.font = `400 ${String(px)}px ${FONT}`;
  ctx.strokeText(value, x, y + px);
  ctx.fillStyle = "rgba(255, 255, 255, 0.72)";
  ctx.fillText(value, x, y + px);
}

/** Board analytics for the stage: iso bars, same rows as the rail. */
export default function RanksAnalytics({
  snapshot,
}: Readonly<{
  snapshot: RanksSnapshot | null;
}>): React.ReactElement {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [canvasFailed, setCanvasFailed] = useState(false);
  const rows = useMemo(
    () => (snapshot === null ? [] : chartRows(snapshot)),
    [snapshot],
  );
  const summary = useMemo(
    () => (snapshot === null ? "Loading board…" : rankSummary(snapshot)),
    [snapshot],
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null || rows.length === 0) {
      return;
    }
    const ctx = canvas.getContext("2d");
    if (ctx === null) {
      setCanvasFailed(true);
      return;
    }
    const bars = rankBars(rows);
    const xs = bars.map((bar) => bar.x);
    const maxH = Math.max(...bars.map((bar) => bar.height));
    const bounds = {
      minX: Math.min(...xs) - 1.2,
      maxX: Math.max(...xs) + 1.2,
      minZ: -1.5,
      maxZ: 1.5,
    };
    let css = STAGE_SQUARE;
    const resize = (): void => {
      css = canvas.clientWidth || STAGE_SQUARE;
      const dpr = Math.min(window.devicePixelRatio || 1, DPR_CAP);
      canvas.width = Math.round(css * dpr);
      canvas.height = Math.round(css * dpr);
    };
    resize();
    const observer = new ResizeObserver(resize);
    if (canvas.parentElement !== null) {
      observer.observe(canvas.parentElement);
    }
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const dpr = (): number => Math.min(window.devicePixelRatio || 1, DPR_CAP);
    let frame = 0;
    const started = performance.now();
    const tick = (): void => {
      const az = reduced ? 0 : Math.sin((performance.now() - started) / 5200) * 0.16;
      const view = { az, el: Math.asin(0.5) };
      const cam = fitCamera(css, bounds, maxH + 1.5, 24);
      ctx.setTransform(dpr(), 0, 0, dpr(), 0, 0);
      ctx.clearRect(0, 0, css, css);
      paintMoonDisc(ctx, cam, view, PALETTE3D.moon, PALETTE3D.crater, RANK_MOON_SEED);
      for (const bar of bars) {
        const color = bar.leader ? PALETTE3D.leader : PALETTE3D.brand;
        isoBox(
          ctx,
          cam,
          {
            x: bar.x,
            z: 0,
            w: 0.95,
            d: 0.95,
            h: bar.height,
            top: shade(color, 1.25),
            left: shade(color, 0.75),
            right: shade(color, 0.55),
          },
          view,
        );
        if (bar.you) {
          const x0 = bar.x - 0.53;
          const x1 = bar.x + 0.53;
          const y1 = bar.height + 0.06;
          line(
            ctx,
            [
              project(cam, x0, y1, -0.53, view),
              project(cam, x1, y1, -0.53, view),
              project(cam, x1, y1, 0.53, view),
              project(cam, x0, y1, 0.53, view),
              project(cam, x0, y1, -0.53, view),
            ],
            toCss(PALETTE3D.leader),
            2,
          );
        }
        const top = project(cam, bar.x, bar.height + 0.55, 0, view);
        label(
          ctx,
          `#${String(bar.position)} ${bar.name}`.slice(0, 18),
          bar.value.toFixed(1),
          top.x,
          top.y,
          Math.max(10, cam.scale * 0.8),
        );
      }
      frame = requestAnimationFrame(tick);
    };
    tick();
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [rows]);

  if (snapshot === null) {
    return (
      <p className="hint" role="status">
        Loading board analytics…
      </p>
    );
  }
  if (snapshot.failed) {
    return (
      <p className="error" role="alert">
        Board unreachable — analytics need the server.
      </p>
    );
  }
  const shift =
    snapshot.game === "all"
      ? "Both shifts"
      : snapshot.game === "city"
        ? "City crisis"
        : "Tote pack-out";
  const scope = `${shift} · ${snapshot.metric}${snapshot.challenge === "" ? "" : ` · ${snapshot.challenge}`}`;
  return (
    <figure className="analytics stage3d">
      <p className="kicker">
        Top {rows.length} · {scope}
      </p>
      {rows.length === 0 ? (
        <p className="hint">No runs on this board yet.</p>
      ) : canvasFailed ? (
        <p className="error" role="alert">
          Canvas is unavailable on this device — the rail table still shows every row.
        </p>
      ) : (
        <canvas
          ref={canvasRef}
          width={STAGE_SQUARE}
          height={STAGE_SQUARE}
          role="img"
          aria-label={summary}
        />
      )}
      <figcaption>{summary}</figcaption>
    </figure>
  );
}
