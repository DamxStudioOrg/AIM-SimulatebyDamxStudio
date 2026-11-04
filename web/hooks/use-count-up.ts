"use client";

import { useEffect, useRef, useState } from "react";
import { usePrefersReducedMotion } from "./use-prefers-reduced-motion";

const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);

/**
 * Rolls the displayed number from its current value to `target` with an
 * ease-out curve. Used by the dashboard chart cards so headline figures
 * animate when the dataset or the hovered point changes. `decimals`
 * keeps fractional targets (per-turn impact) exact; integers stay 0.
 * Reduced motion jumps straight to the target: same value, no roll.
 */
export function useCountUp(target: number, duration = 320, decimals = 0) {
  const [display, setDisplay] = useState(target);
  const fromRef = useRef(target);
  const reducedMotion = usePrefersReducedMotion();
  const factor = 10 ** decimals;

  useEffect(() => {
    const from = fromRef.current;
    if (from === target) return;
    if (reducedMotion) {
      fromRef.current = target;
      setDisplay(target);
      return;
    }
    const start = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      const value =
        Math.round((from + (target - from) * easeOutCubic(t)) * factor) / factor;
      fromRef.current = value;
      setDisplay(value);
      if (t < 1) raf = requestAnimationFrame(tick);
      else fromRef.current = target;
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
    };
  }, [target, duration, factor, reducedMotion]);

  return display;
}
