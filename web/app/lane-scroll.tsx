"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { RefObject } from "react";
import {
  PLANET,
  PLANET_LIMB_TOP_PX,
  lanePlanetInset,
  planetRadius,
} from "@/lib/site-background";

interface ThumbState {
  topPct: number;
  heightPct: number;
  valueNow: number;
  visible: boolean;
}

interface DockState {
  top: number;
  height: number;
  right: number;
}

const HIDDEN: ThumbState = { topPct: 0, heightPct: 100, valueNow: 0, visible: false };

/** Track length as a rail fraction (mirrors the CSS fallback). */
const DOCK_FRACTION = 0.28;
/** Clearance above the tab bar and below the rim crossing. */
const DOCK_BOTTOM_PX = 96;
const DOCK_RIM_PAD_PX = 16;
/** Below this track length, overlap the rim rather than shrink. */
const DOCK_MIN_PX = 96;
/** Viewport-edge offset, mirroring the CSS fallback. */
const LANE_EDGE_PX = 6;

/**
 * Slim scroll rail docked at the planet's bottom-right, always
 * inside the viewport and clear of the rim crossing. It mirrors the
 * page (window) scroll: drag the thumb, arrow-key it, or click the
 * track to jump. The native page scrollbar hides where this rail
 * shows (desktop shell). The body prop only marks the content
 * whose swaps re-measure the page; the window is the scroller.
 */
export default function LaneScroll({
  body,
}: Readonly<{ body: RefObject<HTMLDivElement | null> }>): React.ReactElement {
  const trackRef = useRef<HTMLDivElement | null>(null);
  const drag = useRef<{ startY: number; startTop: number } | null>(null);
  const [thumb, setThumb] = useState<ThumbState>(HIDDEN);
  const [dock, setDock] = useState<DockState | null>(null);

  const sync = useCallback(() => {
    // Rim-aware dock: the track keeps its compact bottom-docked
    // shape where it clears the rim, and nudges down (shrinking to
    // the minimum) where the rim dips across short viewports. The
    // track is viewport-fixed, so the dock measures the window.
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const limbTop = PLANET_LIMB_TOP_PX;
    const radius = planetRadius(viewportWidth, viewportHeight);
    const centerX = PLANET.cx * viewportWidth;
    const centerY = limbTop + radius;
    // Rim at the bar's outer edge, where the curve dips lowest.
    const edge = viewportWidth - LANE_EDGE_PX - centerX;
    const rimTop =
      radius > Math.abs(edge)
        ? centerY - Math.sqrt(radius * radius - edge * edge) + DOCK_RIM_PAD_PX
        : 0;
    const bottom = viewportHeight - DOCK_BOTTOM_PX;
    const naturalHeight = Math.round(viewportHeight * DOCK_FRACTION);
    const top = Math.min(
      Math.max(bottom - naturalHeight, rimTop),
      bottom - DOCK_MIN_PX,
    );
    const topPx = Math.round(top);
    const heightPx = Math.round(Math.min(naturalHeight, bottom - top));
    // The lane stays inside the planet: at the viewport edge while
    // the disc covers it there, stepping in where the rim curves.
    // The step only moves inward, where the rim-top math above is
    // conservative, so the dock keeps clearing the crossing.
    const next = {
      top: topPx,
      height: heightPx,
      right: Math.max(
        LANE_EDGE_PX,
        Math.round(
          lanePlanetInset(
            viewportWidth,
            viewportHeight,
            topPx,
            heightPx,
            DOCK_RIM_PAD_PX,
          ),
        ),
      ),
    };
    setDock((current) =>
      current !== null &&
      current.top === next.top &&
      current.height === next.height &&
      current.right === next.right
        ? current
        : next,
    );
    const page = document.documentElement;
    const overflow = page.scrollHeight - viewportHeight;
    if (overflow <= 0) {
      setThumb((current) => (current.visible ? HIDDEN : current));
      return;
    }
    const heightPct = Math.max(8, (viewportHeight / page.scrollHeight) * 100);
    // Clamp: content swaps (tab changes) can leave scroll past
    // the new overflow, which would park the thumb outside the track.
    const ratio = Math.min(Math.max(window.scrollY / overflow, 0), 1);
    setThumb({
      topPct: ratio * (100 - heightPct),
      heightPct,
      valueNow: Math.round(ratio * 100),
      visible: true,
    });
  }, []);

  useEffect(() => {
    const el = body.current;
    if (el === null) {
      return;
    }
    sync();
    window.addEventListener("scroll", sync, { passive: true });
    window.addEventListener("resize", sync);
    const observer = new ResizeObserver(sync);
    observer.observe(el);
    // Tab switches swap the body's content without firing scroll,
    // so re-measure on DOM changes too: the rail hides on pages
    // with nothing to scroll.
    const mutations = new MutationObserver(sync);
    mutations.observe(el, { childList: true, subtree: true, characterData: true });
    return () => {
      window.removeEventListener("scroll", sync);
      window.removeEventListener("resize", sync);
      observer.disconnect();
      mutations.disconnect();
    };
  }, [body, sync]);

  function scrollToRatio(ratio: number): void {
    const page = document.documentElement;
    window.scrollTo({
      top: Math.min(Math.max(ratio, 0), 1) * (page.scrollHeight - window.innerHeight),
    });
  }

  function onTrackPointerDown(event: React.PointerEvent<HTMLDivElement>): void {
    if ((event.target as Element).closest("[data-lane-thumb]") !== null) {
      return;
    }
    const track = trackRef.current;
    if (track === null) {
      return;
    }
    const rect = track.getBoundingClientRect();
    scrollToRatio((event.clientY - rect.top) / rect.height);
  }

  function onThumbPointerDown(event: React.PointerEvent<HTMLDivElement>): void {
    event.preventDefault();
    (event.target as Element).setPointerCapture(event.pointerId);
    drag.current = { startY: event.clientY, startTop: window.scrollY };
  }

  function onThumbPointerMove(event: React.PointerEvent<HTMLDivElement>): void {
    const held = drag.current;
    const track = trackRef.current;
    if (held === null || track === null) {
      return;
    }
    const rect = track.getBoundingClientRect();
    window.scrollTo({
      top:
        held.startTop +
        ((event.clientY - held.startY) / rect.height) *
          document.documentElement.scrollHeight,
    });
  }

  function onThumbPointerUp(): void {
    drag.current = null;
  }

  function onThumbKeyDown(event: React.KeyboardEvent<HTMLDivElement>): void {
    const step =
      event.key === "PageDown" || event.key === "PageUp" ? window.innerHeight : 40;
    if (event.key === "ArrowDown" || event.key === "PageDown") {
      event.preventDefault();
      window.scrollBy({ top: step });
    } else if (event.key === "ArrowUp" || event.key === "PageUp") {
      event.preventDefault();
      window.scrollBy({ top: -step });
    } else if (event.key === "Home") {
      event.preventDefault();
      window.scrollTo({ top: 0 });
    } else if (event.key === "End") {
      event.preventDefault();
      window.scrollTo({ top: document.documentElement.scrollHeight });
    }
  }

  if (!thumb.visible) {
    return <div className="lane-scroll" aria-hidden="true" />;
  }
  return (
    <div
      ref={trackRef}
      className="lane-scroll"
      onPointerDown={onTrackPointerDown}
      style={
        dock === null
          ? undefined
          : { top: dock.top, height: dock.height, right: dock.right, bottom: "auto" }
      }
    >
      <div
        data-lane-thumb
        className="lane-thumb"
        role="scrollbar"
        aria-controls="arena-page"
        aria-orientation="vertical"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={thumb.valueNow}
        aria-label="Planet content scroll"
        tabIndex={0}
        style={{
          top: `${String(thumb.topPct)}%`,
          height: `${String(thumb.heightPct)}%`,
        }}
        onPointerDown={onThumbPointerDown}
        onPointerMove={onThumbPointerMove}
        onPointerUp={onThumbPointerUp}
        onPointerCancel={onThumbPointerUp}
        onKeyDown={onThumbKeyDown}
      />
    </div>
  );
}
