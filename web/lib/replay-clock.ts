/** Shared replay clock for the canvas stages (city, tote).
One GSAP tween drives painting directly: ticks never re-render React, only a
throttled scrub readout and turn-change callbacks touch component state. */

import { useCallback, useEffect, useRef, useState } from "react";
import gsap from "gsap";

export const TURNS = 12;
export const TYPE_MS = 2000;
export const TICK_MS = 360;
export const FINALE_MS = 1800;
export const STAGE_W = 720;
export const STAGE_H = 540;
/** Square backing for the circular viewports. */
export const STAGE_SQUARE = 640;
/** Scrub readout refreshes at most this often; drawing is unthrottled. */
export const SCRUB_MS = 100;
export const DPR_CAP = 2;

export const FONT = "system-ui, sans-serif";

export function totalMsForTurns(turns: number = TURNS): number {
  return TYPE_MS + turns * TICK_MS + FINALE_MS;
}

export function clamp01(value: number): number {
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

/**
 * Scrub slider track: a brand-to-gold gradient for the played fill
 * and a dark oxblood gradient for the remainder, split at the value.
 */
export function scrubTrack(value: number, max: number): string {
  const split = max <= 0 ? 0 : clamp01(value / max) * 100;
  const at = split.toFixed(1);
  return (
    `linear-gradient(to right, var(--brand) 0%, var(--gold) ${at}%, ` +
    `var(--surface-3) ${at}%, var(--line) 100%)`
  );
}

/** Shown turn at clock time: 1-based, clamped to the match length. */
export function turnAt(t: number, turns: number = TURNS): number {
  const done = Math.max(0, Math.min(turns, Math.floor((t - TYPE_MS) / TICK_MS)));
  return Math.max(1, Math.min(turns, done + (t > TYPE_MS ? 1 : 0)));
}

export interface ReplayClockOptions {
  totalMs: number;
  loop: boolean;
  /** A selected turn freezes the replay (inspection mode). */
  frozen: boolean;
  turns?: number;
  onTurnChange?: (turn: number) => void;
  /** Paint one frame; always called with the latest props via a live ref. */
  draw: (t: number) => void;
}

export interface ReplayClock {
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  scrubMs: number;
  playing: boolean;
  setPlaying: React.Dispatch<React.SetStateAction<boolean>>;
  speed: number;
  setSpeed: React.Dispatch<React.SetStateAction<number>>;
  setScrubbing: React.Dispatch<React.SetStateAction<boolean>>;
  /** Current clock time in ms (for keyboard inspection). */
  phase: () => number;
  seek: (value: number) => void;
  /** Repaint the current frame after a prop change. */
  redraw: () => void;
  /** Restart the clock from zero (replay). */
  restart: () => void;
}

export function useReplayClock(options: ReplayClockOptions): ReplayClock {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [playing, setPlaying] = useState(true);
  const [speed, setSpeed] = useState(1);
  const [scrubMs, setScrubMs] = useState(0);
  const [scrubbing, setScrubbing] = useState(false);
  const [visible, setVisible] = useState(true);
  const phaseRef = useRef(0);
  const tweenRef = useRef<gsap.core.Tween | null>(null);
  const proxyRef = useRef<{ t: number } | null>(null);
  const lastTurnRef = useRef(1);
  const lastScrubRef = useRef(0);
  const live = useRef(options);
  live.current = options;

  const drawAt = useCallback((t: number): void => {
    live.current.draw(t);
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null) {
      return;
    }
    const totalMs = live.current.totalMs;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      phaseRef.current = totalMs;
      const turns = live.current.turns ?? TURNS;
      lastTurnRef.current = turns;
      lastScrubRef.current = totalMs;
      setScrubMs(totalMs);
      live.current.onTurnChange?.(turns);
      drawAt(totalMs);
      return;
    }
    drawAt(0);
    const proxy = { t: 0 };
    proxyRef.current = proxy;
    const tween = gsap.to(proxy, {
      t: totalMs,
      duration: totalMs / 1000,
      ease: "none",
      repeat: live.current.loop ? -1 : 0,
      onUpdate: () => {
        phaseRef.current = proxy.t;
        const turns = live.current.turns ?? TURNS;
        const turn = turnAt(proxy.t, turns);
        if (turn !== lastTurnRef.current) {
          lastTurnRef.current = turn;
          live.current.onTurnChange?.(turn);
        }
        if (
          Math.abs(proxy.t - lastScrubRef.current) >= SCRUB_MS ||
          proxy.t >= totalMs
        ) {
          lastScrubRef.current = proxy.t;
          setScrubMs(proxy.t);
        }
        drawAt(proxy.t);
      },
    });
    tweenRef.current = tween;
    const watcher = new IntersectionObserver((entries) => {
      setVisible(entries[0]?.isIntersecting === true);
    });
    watcher.observe(canvas);
    return () => {
      tween.kill();
      tweenRef.current = null;
      proxyRef.current = null;
      watcher.disconnect();
    };
    // One clock per loop mode; the tween reads live refs, not props.
  }, [options.loop, options.totalMs, drawAt]);

  useEffect(() => {
    tweenRef.current?.paused(!playing || scrubbing || options.frozen || !visible);
  }, [playing, scrubbing, options.frozen, visible]);

  useEffect(() => {
    tweenRef.current?.timeScale(speed);
  }, [speed]);

  const seek = useCallback(
    (value: number): void => {
      phaseRef.current = value;
      const tween = tweenRef.current;
      const proxy = proxyRef.current;
      if (tween !== null && proxy !== null) {
        proxy.t = value;
        tween.pause();
        tween.time(value / 1000);
      }
      lastScrubRef.current = value;
      setScrubMs(value);
      drawAt(value);
    },
    [drawAt],
  );

  const redraw = useCallback((): void => {
    drawAt(phaseRef.current);
  }, [drawAt]);

  const restart = useCallback((): void => {
    const tween = tweenRef.current;
    const proxy = proxyRef.current;
    if (tween !== null && proxy !== null) {
      proxy.t = 0;
      tween.restart();
    }
    phaseRef.current = 0;
    lastTurnRef.current = 1;
    lastScrubRef.current = 0;
    setScrubMs(0);
    drawAt(0);
  }, [drawAt]);

  const phase = useCallback((): number => phaseRef.current, []);

  return {
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
    restart,
  };
}
