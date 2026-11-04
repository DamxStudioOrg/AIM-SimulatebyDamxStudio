"use client";

import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { Button } from "@/components/base/buttons/button";

/**
 * Visual panel publishing: signed-in routes publish a record strip
 * and a scroll-driven stage (viewports, graphs) rendered below
 * the brand mark. React-only on purpose: the header is
 * layout-level, so this module must stay importable without any
 * simulation code (see landing:check).
 */
interface MoonVisualValue {
  stage: ReactNode;
  setStage: (next: ReactNode) => void;
  stats: ReactNode;
  setStats: (next: ReactNode) => void;
  /** Data-visual key driving the stage; null on fallback or clear. */
  activeKey: string | null;
  setActiveKey: (next: string | null) => void;
  /** Page title for routes with no published stage; null clears it. */
  title: string | null;
  setTitle: (next: string | null) => void;
}

const MoonVisualContext = createContext<MoonVisualValue | null>(null);

export function MoonVisualProvider({
  children,
}: Readonly<{ children: ReactNode }>): React.ReactElement {
  const [stage, setStage] = useState<ReactNode>(null);
  const [stats, setStats] = useState<ReactNode>(null);
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [title, setTitle] = useState<string | null>(null);
  const value = useMemo<MoonVisualValue>(
    () => ({
      stage,
      setStage,
      stats,
      setStats,
      activeKey,
      setActiveKey,
      title,
      setTitle,
    }),
    [stage, stats, activeKey, title],
  );
  return (
    <MoonVisualContext.Provider value={value}>{children}</MoonVisualContext.Provider>
  );
}

export function useMoonVisual(): MoonVisualValue {
  const value = useContext(MoonVisualContext);
  if (value === null) {
    throw new Error("useMoonVisual must be used inside <MoonVisualProvider>");
  }
  return value;
}

/**
 * Page title for the left panel: routes with no stage of their own
 * (account, docs, an idle prompt list, a sign-in gate) publish the
 * title their PageHeader shows, so the panel is never a bare moon.
 * A published stage always wins; unmount clears until the next
 * route publishes. Mirror the PageHeader words when calling.
 */
export function useMoonTitle(title: string): void {
  const { setTitle } = useMoonVisual();
  useEffect(() => {
    setTitle(title);
    return () => {
      setTitle(null);
    };
  }, [setTitle, title]);
}

/**
 * Record strip between the brand mark and the scroll-driven visual:
 * renders the published stats, or nothing when no route published
 * any (landing, gate, signed-out).
 */
export function MoonStatsSlot(): React.ReactElement | null {
  const { stats } = useMoonVisual();
  if (stats === null || stats === undefined) {
    return null;
  }
  return <div className="moon-stats-slot">{stats}</div>;
}

/**
 * Live visual below the brand mark: renders the published visual
 * (a viewport or graphs for the section in view on the right),
 * the published page title when no route published a visual, or
 * nothing when neither exists (landing, which keeps the bare
 * moon). Arrival centering and scroll-following live in
 * usePanelFollow (the header owns the scroller, so all
 * programmatic scrolls share one drive flag and never trip the
 * manual pin). The enlarge toggle floats the visual into a large
 * overlay (same idea as the stage's own enlarge); Escape or the
 * toggle shrinks it back. The title needs no enlarge.
 */
export function MoonStage(): React.ReactElement | null {
  const { stage, title } = useMoonVisual();
  const slotRef = useRef<HTMLDivElement | null>(null);
  const [big, setBig] = useState(false);
  const hasStage = stage !== null && stage !== undefined;
  useEffect(() => {
    if (!big) {
      return;
    }
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        setBig(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
    };
  }, [big]);
  if (!hasStage) {
    if (title === null) {
      return null;
    }
    return <p className="moon-stage-title">{title}</p>;
  }
  return (
    <div ref={slotRef} className={`moon-stage-slot${big ? " is-big" : ""}`}>
      <p className="moon-stage-tools">
        <Button
          variant="ghost"
          size="xs"
          aria-expanded={big}
          onClick={() => {
            setBig((value) => !value);
          }}
        >
          {big ? "Shrink visual" : "Enlarge visual"}
        </Button>
      </p>
      {stage}
    </div>
  );
}
