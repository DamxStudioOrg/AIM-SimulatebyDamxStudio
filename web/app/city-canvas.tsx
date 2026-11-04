"use client";

import { useCallback, useEffect, useRef } from "react";
import { Button } from "@/components/base/buttons/button";
import type { ChallengeAssets } from "@/lib/asset-schema";
import { DEFAULT_ASSETS } from "@/lib/asset-schema";
import {
  downloadCanvasPng,
  exportFilename,
  exportVideoFilename,
  recordCanvasWebm,
} from "@/lib/canvas-export";
import { ISO_AZ_LIMIT, isoDiscRadii } from "@/lib/iso";
import type { IsoView } from "@/lib/iso";
import {
  describeCityScene,
  pickDiscTurn,
  renderScene,
  sceneCamera,
  sceneMaxY,
} from "@/lib/render-mcp";
import {
  DPR_CAP,
  FINALE_MS,
  STAGE_SQUARE,
  TICK_MS,
  TURNS,
  TYPE_MS,
  scrubTrack,
  totalMsForTurns,
  turnAt,
  useReplayClock,
} from "@/lib/replay-clock";
import type { MatchResultPayload } from "@/lib/sim";
import {
  companionAngle,
  companionFactor,
  companionStep,
  turnDiscs,
} from "@/lib/stage3d";
import StageViewTools, {
  UiCollapseToggle,
  useStageUi,
  useStageView,
} from "./stage-view-tools";

export interface CityCanvasProps {
  result: MatchResultPayload;
  prompt: string;
  loop?: boolean;
  selectedTurn?: number | null;
  onTurnChange?: (turn: number) => void;
  onSelectTurn?: (turn: number | null) => void;
  /** Rotation-trial dressing; validated upstream, defaults when absent. */
  assets?: ChallengeAssets | null;
}

/** Full city replay length: typing, twelve turns, finale, hold. */
export const CITY_TOTAL_MS = TYPE_MS + TURNS * TICK_MS + FINALE_MS + 1400;

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}

/**
 * Canvas2D city stage: one tower per budget key, one fitted iso
 * frame, drag-orbit (yaw plus squash), flood/heat shock washes,
 * clickable turn discs. The shared replay clock drives every frame;
 * each frame describes a SceneJSON snapshot and paints it, so the
 * model-facing scene graph and the pixels can never drift apart.
 * No WebGL anywhere: export reads the canvas directly.
 */
export default function CityCanvas({
  result,
  prompt,
  loop = false,
  selectedTurn = null,
  onTurnChange,
  onSelectTurn,
  assets = null,
}: CityCanvasProps): React.ReactElement {
  const turns = result.turns.length;
  const totalMs = totalMsForTurns(turns) + 1400;
  const ctxRef = useRef<CanvasRenderingContext2D | null>(null);
  const sizeRef = useRef<number | null>(null);
  const dprRef = useRef(1);
  const totalMsRef = useRef(totalMs);
  totalMsRef.current = totalMs;
  const orbit = useRef({ az: 0, pol: 0 });
  const drag = useRef<{ x: number; y: number; moved: boolean } | null>(null);
  const figureRef = useRef<HTMLElement | null>(null);
  const view = useStageView(figureRef);
  const ui = useStageUi();
  const companionLink = useRef({ target: 1, current: 1 });
  const companionBase = useRef(1);
  const dress = assets ?? DEFAULT_ASSETS;
  companionBase.current = dress.moon.size;
  const heightScale = dress.towers.heightScale;
  const widthScale = dress.towers.widthScale;
  const live = useRef({ result, selectedTurn, heightScale, widthScale, dress });
  live.current = { result, selectedTurn, heightScale, widthScale, dress };

  const viewFor = useCallback(
    (t: number, frozen: boolean, reduced: boolean): IsoView => {
      const sway = reduced || frozen ? 0 : Math.sin(t / 4200) * 0.045;
      return {
        az: clamp(orbit.current.az + sway, -ISO_AZ_LIMIT, ISO_AZ_LIMIT),
        el: clamp(Math.asin(0.5) - orbit.current.pol * 0.5, 0.2, 1.25),
      };
    },
    [],
  );

  const draw = useCallback(
    (t: number): void => {
      const ctx = ctxRef.current;
      const css = sizeRef.current;
      if (ctx === null || css === null) {
        return;
      }
      const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      const current = live.current;
      const frozen = current.selectedTurn !== null;
      const turnFloat = (t - TYPE_MS) / TICK_MS;
      const link = companionLink.current;
      link.current = companionStep(link.current, link.target, reduced);
      const scene = describeCityScene({
        result: current.result,
        t,
        turnFloat,
        selectedTurn: current.selectedTurn,
        reduced,
        assets: current.dress,
        heightScale: current.heightScale,
        widthScale: current.widthScale,
        companion: {
          scale: companionBase.current * link.current,
          angle: companionAngle(frozen ? 0 : t, reduced),
        },
        totalMs: totalMsRef.current,
      });
      ctx.setTransform(dprRef.current, 0, 0, dprRef.current, 0, 0);
      renderScene(ctx, scene, css, { view: viewFor(t, frozen, reduced) });
    },
    [viewFor],
  );

  const {
    canvasRef,
    scrubMs,
    playing,
    setPlaying,
    speed,
    setSpeed,
    setScrubbing,
    phase,
    seek,
    redraw,
  } = useReplayClock({
    totalMs,
    loop,
    frozen: selectedTurn !== null,
    turns,
    onTurnChange,
    draw,
  });

  // Companion link: this viewport is the moon; its companion eases
  // smaller as the moon grows (see stage3d companionFactor).
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
  }, [result, prompt, selectedTurn, assets, redraw]);

  function exportPng(): void {
    redraw();
    downloadCanvasPng(canvasRef.current, exportFilename("city", result.seed));
  }

  function exportWebm(): void {
    seek(0);
    setPlaying(true);
    void recordCanvasWebm(
      canvasRef.current,
      exportVideoFilename("city", result.seed),
      totalMs / speed,
    );
  }

  function pickDisc(event: React.PointerEvent<HTMLCanvasElement>): void {
    if (onSelectTurn === undefined) {
      return;
    }
    const canvas = canvasRef.current;
    const css = sizeRef.current;
    if (canvas === null || css === null) {
      return;
    }
    const rect = canvas.getBoundingClientRect();
    const px = ((event.clientX - rect.left) / rect.width) * css;
    const py = ((event.clientY - rect.top) / rect.height) * css;
    const frozen = selectedTurn !== null;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const t = phase();
    const current = live.current;
    const scene = describeCityScene({
      result: current.result,
      t,
      turnFloat: (t - TYPE_MS) / TICK_MS,
      selectedTurn: current.selectedTurn,
      reduced,
      assets: current.dress,
      heightScale: current.heightScale,
      widthScale: current.widthScale,
      companion: {
        scale: companionBase.current * companionLink.current.current,
        angle: companionAngle(frozen ? 0 : t, reduced),
      },
      totalMs: totalMsRef.current,
    });
    const cam = sceneCamera("city", css, sceneMaxY(scene));
    const frame = viewFor(t, frozen, reduced);
    const { rx } = isoDiscRadii(0.5, cam.scale, frame);
    const best = pickDiscTurn(
      turnDiscs(result.turns.length),
      cam,
      frame,
      px,
      py,
      Math.max(12, rx),
    );
    if (best !== null) {
      onSelectTurn(best === selectedTurn ? null : best);
    }
  }

  const effectivelyPaused = !playing || selectedTurn !== null;
  const finaleOn = scrubMs >= TYPE_MS + TURNS * TICK_MS;
  const ariaSummary =
    `City replay of seed ${String(result.seed)}: one tower per budget key rises and ` +
    `falls across twelve turns, impact ${(result.scores.impact ?? 0).toFixed(1)}. ` +
    `Drag to orbit; left and right arrows inspect turns; Escape resumes.`;

  return (
    <figure ref={figureRef} className={`cartoon stage3d${view.big ? " is-big" : ""}`}>
      <canvas
        ref={canvasRef}
        width={STAGE_SQUARE}
        height={STAGE_SQUARE}
        role={onSelectTurn === undefined ? "img" : undefined}
        aria-label={ariaSummary}
        tabIndex={onSelectTurn === undefined ? undefined : 0}
        style={
          onSelectTurn === undefined
            ? undefined
            : { cursor: "pointer", touchAction: "none" }
        }
        onPointerDown={(event) => {
          drag.current = { x: event.clientX, y: event.clientY, moved: false };
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={(event) => {
          const start = drag.current;
          if (start === null) {
            return;
          }
          const dx = event.clientX - start.x;
          const dy = event.clientY - start.y;
          if (Math.abs(dx) + Math.abs(dy) > 6) {
            start.moved = true;
          }
          if (start.moved) {
            orbit.current.az = clamp(
              orbit.current.az - dx * 0.005,
              -ISO_AZ_LIMIT,
              ISO_AZ_LIMIT,
            );
            orbit.current.pol = clamp(orbit.current.pol + dy * 0.004, -0.55, 0.9);
            start.x = event.clientX;
            start.y = event.clientY;
            redraw();
          }
        }}
        onPointerUp={(event) => {
          const wasDrag = drag.current?.moved === true;
          drag.current = null;
          if (!wasDrag) {
            pickDisc(event);
          }
        }}
        onKeyDown={(event) => {
          if (onSelectTurn === undefined) {
            return;
          }
          if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
            event.preventDefault();
            const base = selectedTurn ?? turnAt(phase());
            const delta = event.key === "ArrowRight" ? 1 : -1;
            onSelectTurn(Math.min(TURNS, Math.max(1, base + delta)));
          } else if (
            event.key === "Escape" ||
            event.key === "Enter" ||
            event.key === " "
          ) {
            event.preventDefault();
            onSelectTurn(null);
          }
        }}
      />
      {finaleOn && result.provider !== "demo" && (
        <div className="stage-plaque" role="status">
          <p className="stage-plaque-title">Final stewardship</p>
          <p className="stage-plaque-score">{(result.scores.impact ?? 0).toFixed(1)}</p>
          <p>
            impact · efficiency {(result.scores.efficiency ?? 0).toFixed(1)} · seed{" "}
            {result.seed} · {result.provider}
          </p>
        </div>
      )}
      <div
        className={`replay-controls${ui.open ? " is-open" : ""}`}
        onMouseEnter={ui.hold}
        onMouseLeave={ui.release}
        onFocus={ui.hold}
        onBlur={ui.release}
      >
        <UiCollapseToggle ui={ui} controlsId="city-ui-body" />
        <div className="ui-body" id="city-ui-body">
          <div className="ui-body-inner">
            <Button
              variant="ghost"
              size="xs"
              aria-pressed={effectivelyPaused}
              onClick={() => {
                if (selectedTurn !== null) {
                  onSelectTurn?.(null);
                  setPlaying(true);
                } else {
                  setPlaying((previous) => !previous);
                }
              }}
            >
              {effectivelyPaused ? "Play" : "Pause"}
            </Button>
            <label className="speed-select">
              Speed
              <select
                value={speed}
                aria-label="Replay speed"
                onChange={(event) => {
                  setSpeed(Number(event.target.value));
                }}
              >
                <option value={0.5}>0.5×</option>
                <option value={1}>1×</option>
                <option value={2}>2×</option>
                <option value={4}>4×</option>
              </select>
            </label>
            <input
              type="range"
              min={0}
              max={totalMs}
              step={20}
              value={Math.round(scrubMs)}
              aria-label="Scrub replay"
              style={{
                background: `${scrubTrack(scrubMs, totalMs)} center / 100% 6px no-repeat`,
              }}
              onPointerDown={() => {
                setScrubbing(true);
              }}
              onPointerUp={() => {
                setScrubbing(false);
              }}
              onChange={(event) => {
                seek(Number(event.target.value));
              }}
            />
            <span className="num">
              {(scrubMs / 1000).toFixed(1)}s / {(totalMs / 1000).toFixed(0)}s
            </span>
            <Button variant="ghost" size="xs" onClick={exportPng}>
              Export PNG
            </Button>
            <Button variant="ghost" size="xs" onClick={exportWebm}>
              Export WebM
            </Button>
            <StageViewTools view={view} />
          </div>
        </div>
      </div>
    </figure>
  );
}
