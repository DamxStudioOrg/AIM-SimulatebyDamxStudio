"use client";

import { useCallback, useEffect, useMemo, useRef } from "react";
import { Button } from "@/components/base/buttons/button";
import { downloadCanvasPng, exportFilename } from "@/lib/canvas-export";
import { describeToteScene, renderScene } from "@/lib/render-mcp";
import { DPR_CAP, FINALE_MS, STAGE_SQUARE, useReplayClock } from "@/lib/replay-clock";
import type { ToteCatalog, TotePackResult } from "@/lib/sim";
import {
  TOTE_ITEM_MS,
  TOTE_TYPE_MS,
  companionAngle,
  companionFactor,
  companionStep,
} from "@/lib/stage3d";
import StageViewTools, {
  UiCollapseToggle,
  useStageUi,
  useStageView,
} from "./stage-view-tools";

interface ToteCanvasProps {
  catalog: ToteCatalog | null;
  result: TotePackResult | null;
  prompt: string;
}

/**
 * Canvas2D crane pack-out: the crane lifts each crate off the
 * pallet and lowers it into the levitating tote trailer's bin, in
 * the model's packing order. Before a run (or between tasks) the
 * trailer just hovers by the crane. Each frame describes a
 * SceneJSON snapshot and paints it — no WebGL anywhere.
 */
export default function ToteCanvas({
  catalog,
  result,
  prompt,
}: ToteCanvasProps): React.ReactElement {
  const packing = useMemo(
    () => (result !== null && result.invalid_reason === null ? result.packing : []),
    [result],
  );
  const totalMs = TOTE_TYPE_MS + Math.max(packing.length, 1) * TOTE_ITEM_MS + FINALE_MS;
  const ctxRef = useRef<CanvasRenderingContext2D | null>(null);
  const sizeRef = useRef<number | null>(null);
  const dprRef = useRef(1);
  const totalMsRef = useRef(totalMs);
  totalMsRef.current = totalMs;
  const figureRef = useRef<HTMLElement | null>(null);
  const view = useStageView(figureRef);
  const ui = useStageUi();
  const companionLink = useRef({ target: 1, current: 1 });
  const live = useRef({ catalog, result });
  live.current = { catalog, result };

  const draw = useCallback((t: number): void => {
    const ctx = ctxRef.current;
    const css = sizeRef.current;
    if (ctx === null || css === null) {
      return;
    }
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const current = live.current;
    const link = companionLink.current;
    link.current = companionStep(link.current, link.target, reduced);
    const scene = describeToteScene({
      catalog: current.catalog,
      result: current.result,
      t,
      reduced,
      companion: {
        scale: link.current,
        angle: companionAngle(t, reduced),
      },
      totalMs: totalMsRef.current,
    });
    ctx.setTransform(dprRef.current, 0, 0, dprRef.current, 0, 0);
    renderScene(ctx, scene, css);
  }, []);

  const { canvasRef, scrubMs, playing, setPlaying, redraw, restart } = useReplayClock({
    totalMs,
    loop: result === null,
    frozen: false,
    draw,
  });

  // Companion link eases with viewport width, like the city stage.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null) {
      return;
    }
    const update = (): void => {
      companionLink.current.target = companionFactor(canvas.clientWidth);
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(canvas);
    return () => {
      observer.disconnect();
    };
  }, [canvasRef]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null) {
      return;
    }
    const ctx = canvas.getContext("2d");
    if (ctx === null) {
      return;
    }
    ctxRef.current = ctx;
    const resize = (): void => {
      const css = canvas.clientWidth || STAGE_SQUARE;
      const dpr = Math.min(window.devicePixelRatio || 1, DPR_CAP);
      dprRef.current = dpr;
      sizeRef.current = css;
      canvas.width = Math.round(css * dpr);
      canvas.height = Math.round(css * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      redraw();
    };
    resize();
    const observer = new ResizeObserver(resize);
    if (canvas.parentElement !== null) {
      observer.observe(canvas.parentElement);
    }
    return () => {
      observer.disconnect();
      ctxRef.current = null;
      sizeRef.current = null;
    };
    // Canvas setup once; frames read live props via refs.
  }, [canvasRef, redraw]);

  useEffect(() => {
    redraw();
  }, [catalog, result, prompt, redraw]);

  function exportPng(): void {
    redraw();
    downloadCanvasPng(canvasRef.current, exportFilename("tote", result?.seed ?? 0));
  }

  const finaleOn =
    result !== null && scrubMs >= TOTE_TYPE_MS + packing.length * TOTE_ITEM_MS;
  const ariaSummary =
    result === null
      ? "Moon stage: a crane beside a levitating tote trailer, waiting for a packing task."
      : result.invalid_reason !== null
        ? `Crane pack-out for seed ${String(result.seed)}: invalid packing (${result.invalid_reason}).`
        : `Crane pack-out for seed ${String(result.seed)}: ${String(packing.length)} items packed, score ${result.score.toFixed(1)}.`;

  return (
    <figure ref={figureRef} className={`cartoon stage3d${view.big ? " is-big" : ""}`}>
      <canvas
        ref={canvasRef}
        width={STAGE_SQUARE}
        height={STAGE_SQUARE}
        role="img"
        aria-label={ariaSummary}
      />
      {finaleOn && (
        <div className="stage-plaque" role="status">
          {result.invalid_reason !== null ? (
            <>
              <p className="stage-plaque-title">No valid packing</p>
              <p>{result.invalid_reason}</p>
            </>
          ) : (
            <>
              <p className="stage-plaque-title">Tote verdict</p>
              <p className="stage-plaque-score">{result.score.toFixed(1)}</p>
              <p>
                value {result.value.toFixed(1)} − damage{" "}
                {result.damage.total.toFixed(1)} · seed {result.seed} ·{" "}
                {result.provider}
              </p>
            </>
          )}
        </div>
      )}
      <div
        className={`replay-controls${ui.open ? " is-open" : ""}`}
        onMouseEnter={ui.hold}
        onMouseLeave={ui.release}
        onFocus={ui.hold}
        onBlur={ui.release}
      >
        <UiCollapseToggle ui={ui} controlsId="tote-ui-body" />
        <div className="ui-body" id="tote-ui-body">
          <div className="ui-body-inner">
            <Button
              variant="ghost"
              size="xs"
              aria-pressed={!playing}
              onClick={() => {
                setPlaying((previous) => !previous);
              }}
            >
              {playing ? "Pause" : "Play"}
            </Button>
            <Button
              variant="ghost"
              size="xs"
              onClick={() => {
                restart();
                setPlaying(true);
              }}
            >
              Replay
            </Button>
            <span className="num">
              {(scrubMs / 1000).toFixed(1)}s / {(totalMs / 1000).toFixed(0)}s
            </span>
            <Button variant="ghost" size="xs" onClick={exportPng}>
              Export PNG
            </Button>
            <StageViewTools view={view} />
          </div>
        </div>
      </div>
    </figure>
  );
}
