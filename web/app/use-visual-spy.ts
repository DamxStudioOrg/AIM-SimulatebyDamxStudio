"use client";

import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { useMoonVisual } from "./moon-visual";

/**
 * Scroll spy for the left visual panel: visible `[data-visual]`
 * sections rank by intersection ratio, and the top-ranked section
 * WITH a mapped visual publishes to the moon stage slot. Sections
 * absent from the map — or mapping to null, like a closed
 * deep-dive — yield to the next visible section instead of blanking
 * the slot; with nothing visible carrying a visual, the slot shows
 * the fallback (a route's default stage, e.g. the demo simulation)
 * or clears back to the moon when no fallback is set. Late-mounted
 * sections (gated scopes mount after auth) join via MutationObserver.
 * React-only like the provider: nodes cross, never sim imports.
 *
 * One spy per route. Nested spies would fight over the single slot;
 * nested SECTIONS are fine (the fully-visible inner one outranks its
 * parent by ratio, which is how the aftermath deep-dive beats its
 * result when open).
 *
 * Callers must memoize the map AND the fallback (useMemo on their
 * data): identity re-publishes fresh content for the standing
 * winner, and inline nodes would re-publish every render.
 */
export function useVisualSpy(
  visuals: Record<string, ReactNode | null>,
  fallback: ReactNode | null = null,
): void {
  const { setStage, setActiveKey } = useMoonVisual();
  const ratios = useRef(new Map<string, number>());
  const [tick, setTick] = useState(0);
  const last = useRef<ReactNode | null>(null);
  useEffect(() => {
    const ranked = [...ratios.current.entries()].sort((a, b) => b[1] - a[1]);
    const found = ranked.find(
      ([key, ratio]) =>
        ratio > 0 && visuals[key] !== null && visuals[key] !== undefined,
    );
    const node = found === undefined ? fallback : visuals[found[0]];
    if (last.current !== node) {
      last.current = node ?? null;
      setStage(node ?? null);
    }
    setActiveKey(found === undefined ? null : found[0]);
  }, [setStage, setActiveKey, visuals, fallback, tick]);
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const key = (entry.target as HTMLElement).dataset.visual;
          if (key !== undefined) {
            ratios.current.set(key, entry.isIntersecting ? entry.intersectionRatio : 0);
          }
        }
        setTick((value) => value + 1);
      },
      { threshold: [0, 0.1, 0.25, 0.5, 0.75, 1] },
    );
    const watch = (): void => {
      document.querySelectorAll("[data-visual]").forEach((element) => {
        observer.observe(element);
      });
    };
    watch();
    const late = new MutationObserver(watch);
    late.observe(document.body, { childList: true, subtree: true });
    return () => {
      observer.disconnect();
      late.disconnect();
      setStage(null);
    };
  }, [setStage]);
}
