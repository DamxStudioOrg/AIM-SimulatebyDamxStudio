"use client";

import { useEffect, useRef } from "react";
import type { RefObject } from "react";
import { followTarget } from "@/lib/panel-follow";
import { useMoonVisual } from "./moon-visual";

/**
 * Left-panel follow: right-panel scrolls drift the panel's scroller
 * through tall published visuals in proportion to the driving
 * section's traversal. Any manual touch of the panel (wheel,
 * drag, keys, tap-drag) pins it — it stays put until a fresh
 * visual or section arrives. Respects reduced motion, and stands
 * down while the enlarged overlay owns the visual.
 */
export function usePanelFollow(scrollerRef: RefObject<HTMLDivElement | null>): void {
  const { stage, activeKey } = useMoonVisual();
  const pinned = useRef(false);
  const driving = useRef(false);

  // Fresh content unpins and centers: mark + stats + visual
  // overflow the square, and the new arrival is what the steward
  // just ran or scrolled to — nearest-edge scrolling left the
  // canvas below the fold on short windows. The drive flag is set
  // so the centering echo doesn't trip the manual pin.
  // Re-publishes of the standing visual must not steal scroll back.
  const hadStage = useRef(false);
  useEffect(() => {
    pinned.current = false;
    const hasStage = stage !== null && stage !== undefined;
    if (hasStage && !hadStage.current) {
      const scroller = scrollerRef.current;
      // Center the visual itself (canvas, graph, figure) — centering
      // the slot leaves the canvas half a toolbar below middle.
      const target =
        scroller?.querySelector(".moon-stage-slot canvas") ??
        scroller?.querySelector(".moon-stage-slot svg") ??
        scroller?.querySelector(".moon-stage-slot figure") ??
        scroller?.querySelector(".moon-stage-slot");
      if (target instanceof HTMLElement) {
        driving.current = true;
        target.scrollIntoView({ block: "center" });
        window.setTimeout(() => {
          driving.current = false;
        }, 120);
      }
    }
    hadStage.current = hasStage;
  }, [stage, activeKey, scrollerRef]);

  useEffect(() => {
    const scroller = scrollerRef.current;
    if (scroller === null) {
      return;
    }
    const onScroll = (): void => {
      // Our own drive echoes back as one scroll event; swallow it,
      // and pin on anything else the hand does.
      if (driving.current) {
        driving.current = false;
        return;
      }
      pinned.current = true;
    };
    const onTouch = (): void => {
      pinned.current = true;
    };
    const onPress = (event: PointerEvent): void => {
      // Control clicks (enlarge, links) aren't scroll intent.
      if (
        event.target instanceof HTMLElement &&
        event.target.closest("button, a") !== null
      ) {
        return;
      }
      pinned.current = true;
    };
    scroller.addEventListener("scroll", onScroll, { passive: true });
    scroller.addEventListener("wheel", onTouch, { passive: true });
    scroller.addEventListener("touchmove", onTouch, { passive: true });
    scroller.addEventListener("pointerdown", onPress);
    return () => {
      scroller.removeEventListener("scroll", onScroll);
      scroller.removeEventListener("wheel", onTouch);
      scroller.removeEventListener("touchmove", onTouch);
      scroller.removeEventListener("pointerdown", onPress);
    };
  }, [scrollerRef]);

  useEffect(() => {
    if (
      typeof window === "undefined" ||
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
      return;
    }
    let frame = 0;
    const drive = (): void => {
      frame = 0;
      const scroller = scrollerRef.current;
      if (scroller === null || pinned.current || activeKey === null) {
        return;
      }
      if (scroller.querySelector(".is-big") !== null) {
        return;
      }
      const section = document.querySelector(`[data-visual="${activeKey}"]`);
      if (!(section instanceof HTMLElement)) {
        return;
      }
      const rect = section.getBoundingClientRect();
      const target = followTarget(
        rect.top,
        rect.height,
        window.innerHeight,
        scroller.scrollHeight - scroller.clientHeight,
      );
      if (target === null || Math.abs(scroller.scrollTop - target) < 1) {
        return;
      }
      driving.current = true;
      scroller.scrollTop = target;
      // If no scroll event echoes (clamped, hidden), release the
      // latch so the next manual touch still pins.
      window.setTimeout(() => {
        driving.current = false;
      }, 120);
    };
    const onScroll = (): void => {
      if (frame !== 0) {
        return;
      }
      frame = window.requestAnimationFrame(drive);
    };
    // Document-level capture: the right panel scrolls inside its own
    // container (the window never moves), and scroll events don't
    // bubble — capture catches every scroller, window included. The
    // panel's own echoes re-enter harmlessly: the drive only writes
    // when a full pixel off target, so an echo schedules a no-op.
    document.addEventListener("scroll", onScroll, {
      capture: true,
      passive: true,
    });
    // One pass for the standing position: the active key can change
    // (or mount settled) with no further scroll to trigger on.
    onScroll();
    return () => {
      document.removeEventListener("scroll", onScroll, { capture: true });
      if (frame !== 0) {
        window.cancelAnimationFrame(frame);
      }
    };
  }, [scrollerRef, activeKey]);
}
