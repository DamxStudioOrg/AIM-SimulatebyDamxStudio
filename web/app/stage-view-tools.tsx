"use client";

import { useCallback, useEffect, useState } from "react";
import type { RefObject } from "react";
import {
  ArrowsInIcon,
  ArrowsOutIcon,
  CornersInIcon,
  CornersOutIcon,
  MoonIcon,
  SlidersHorizontalIcon,
} from "@phosphor-icons/react";
import type { StageMode } from "@/lib/stage-mode";

export interface StageView {
  big: boolean;
  isFullscreen: boolean;
  toggleBig: () => void;
  toggleFullscreen: () => void;
}

/** Enlarge + fullscreen state shared by the moon stage figures. */
export function useStageView(figureRef: RefObject<HTMLElement | null>): StageView {
  const [big, setBig] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);

  useEffect(() => {
    function onFsChange(): void {
      setIsFullscreen(document.fullscreenElement === figureRef.current);
    }
    document.addEventListener("fullscreenchange", onFsChange);
    return () => {
      document.removeEventListener("fullscreenchange", onFsChange);
    };
  }, [figureRef]);

  return {
    big,
    isFullscreen,
    toggleBig: () => {
      setBig((value) => !value);
    },
    toggleFullscreen: () => {
      if (document.fullscreenElement !== null) {
        void document.exitFullscreen();
      } else {
        void figureRef.current?.requestFullscreen();
      }
    },
  };
}

const UI_IDLE_MS = 5000;

export interface StageUi {
  open: boolean;
  toggle: () => void;
  hold: () => void;
  release: () => void;
}

/**
 * Collapsible stage UI: the strip starts closed on a single toggle
 * button; clicking opens it, and 5s without hover or focus closes
 * it again. The `.ui-body` grid animates the open/close in CSS.
 */
export function useStageUi(): StageUi {
  const [open, setOpen] = useState(false);
  const [held, setHeld] = useState(false);

  useEffect(() => {
    if (!open || held) {
      return;
    }
    const timer = window.setTimeout(() => {
      setOpen(false);
    }, UI_IDLE_MS);
    return () => {
      window.clearTimeout(timer);
    };
  }, [open, held]);

  const toggle = useCallback(() => {
    setOpen((value) => !value);
  }, []);
  const hold = useCallback(() => {
    setHeld(true);
  }, []);
  const release = useCallback(() => {
    setHeld(false);
  }, []);
  return { open, toggle, hold, release };
}

/** The single toggle button the collapsed strip shows. */
export function UiCollapseToggle({
  ui,
  controlsId,
}: Readonly<{ ui: StageUi; controlsId: string }>): React.ReactElement {
  return (
    <button
      type="button"
      className="ghost icon-button"
      aria-expanded={ui.open}
      aria-controls={controlsId}
      aria-label={ui.open ? "Hide stage controls" : "Show stage controls"}
      onClick={ui.toggle}
    >
      <SlidersHorizontalIcon size={18} aria-hidden="true" />
    </button>
  );
}

/**
 * Viewport mode switch: Simulation fills the center screen with the
 * sim and hides the rail; Controls shows the full console with
 * the planet in the viewport. Lives in the site header.
 */
export function ModeSwitch({
  mode,
  onSelect,
}: Readonly<{
  mode: StageMode;
  onSelect: (next: StageMode) => void;
}>): React.ReactElement {
  return (
    <div className="mode-switch" role="group" aria-label="Viewport mode">
      <button
        type="button"
        className="ghost"
        aria-pressed={mode === "simulation"}
        onClick={() => {
          onSelect("simulation");
        }}
      >
        <MoonIcon size={16} aria-hidden="true" /> Simulation
      </button>
      <button
        type="button"
        className="ghost"
        aria-pressed={mode === "controls"}
        onClick={() => {
          onSelect("controls");
        }}
      >
        <SlidersHorizontalIcon size={16} aria-hidden="true" /> Controls
      </button>
    </div>
  );
}

/** What fills the Simulation center: the sim, the ranks chart, or stats. */
export type CenterView = "game" | "ranks" | "stats";

/** Enlarge / full-screen buttons floated on the stage viewport. */
export default function StageViewTools({
  view,
}: Readonly<{ view: StageView }>): React.ReactElement {
  return (
    <div className="stage-view-tools">
      <button
        type="button"
        className="ghost icon-button"
        aria-pressed={view.big}
        aria-label={view.big ? "Shrink stage" : "Enlarge stage"}
        onClick={view.toggleBig}
      >
        {view.big ? (
          <ArrowsInIcon size={18} aria-hidden="true" />
        ) : (
          <ArrowsOutIcon size={18} aria-hidden="true" />
        )}
      </button>
      <button
        type="button"
        className="ghost icon-button"
        aria-pressed={view.isFullscreen}
        aria-label={view.isFullscreen ? "Exit full screen" : "Full screen"}
        onClick={view.toggleFullscreen}
      >
        {view.isFullscreen ? (
          <CornersInIcon size={18} aria-hidden="true" />
        ) : (
          <CornersOutIcon size={18} aria-hidden="true" />
        )}
      </button>
    </div>
  );
}
