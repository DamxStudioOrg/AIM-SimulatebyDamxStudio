"use client";

import { useEffect } from "react";
import { pickLitId, type LitCandidate } from "@/lib/scroll-motion";

/**
 * Nearest ancestor that actually scrolls: the planet's inner scroller
 * (the page itself never scrolls in the fixed two-panel layout).
 * Null when nothing scrolls (short content), where the highlight
 * falls back to viewport intersection.
 */
export function findScrollParent(element: HTMLElement | null): HTMLElement | null {
  let node = element?.parentElement ?? null;
  while (node !== null) {
    if (node.scrollHeight > node.clientHeight + 1) {
      return node;
    }
    node = node.parentElement;
  }
  return null;
}

/**
 * Scroll-linked text highlight: observes every `[data-highlight]` block
 * in the scope and keeps `.is-lit` on the most visible one, so the
 * passage being read brightens while the rest rest. The scope arrives
 * as a node (callback ref + state), not a ref object: gated scopes
 * like the console's mount after sign-in, and the effect must
 * subscribe then — a ref read once would stay null forever. A
 * mutation observer re-collects blocks because the slideshow swaps
 * slide content under a mounted scope.
 */
export function useScrollHighlight(node: HTMLElement | null): void {
  useEffect(() => {
    const host = node;
    if (host === null || typeof IntersectionObserver === "undefined") {
      return;
    }
    const readings = new Map<string, { ratio: number; visible: boolean }>();
    const observed = new Set<HTMLElement>();
    let nextId = 0;

    const apply = (): void => {
      const blocks: LitCandidate[] = [...observed].map((block) => {
        const reading = readings.get(block.dataset.hid ?? "");
        return {
          id: block.dataset.hid ?? "",
          ratio: reading?.ratio ?? 0,
          visible: reading?.visible ?? false,
        };
      });
      const lit = pickLitId(blocks);
      for (const block of observed) {
        block.classList.toggle("is-lit", block.dataset.hid === lit);
      }
    };

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const id = (entry.target as HTMLElement).dataset.hid;
          if (id !== undefined) {
            readings.set(id, {
              ratio: entry.intersectionRatio,
              visible: entry.isIntersecting,
            });
          }
        }
        apply();
      },
      { root: findScrollParent(host), threshold: [0, 0.25, 0.5, 0.75, 1] },
    );

    const collect = (): void => {
      const blocks = host.querySelectorAll<HTMLElement>("[data-highlight]");
      for (const block of blocks) {
        if (observed.has(block)) {
          continue;
        }
        if (block.dataset.hid === undefined) {
          block.dataset.hid = `hl-${String(nextId)}`;
          nextId += 1;
        }
        observed.add(block);
        observer.observe(block);
      }
      for (const block of [...observed]) {
        if (!host.contains(block)) {
          observed.delete(block);
          observer.unobserve(block);
        }
      }
      apply();
    };

    collect();
    const mutations = new MutationObserver(collect);
    mutations.observe(host, { childList: true, subtree: true });
    return () => {
      mutations.disconnect();
      observer.disconnect();
    };
  }, [node]);
}
