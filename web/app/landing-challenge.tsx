"use client";

import { useEffect } from "react";
import { useMoonVisual } from "./moon-visual";

/**
 * The landing's left-panel challenge: talk is cheap, the board
 * keeps score. Pure copy — no simulation imports, so the
 * marketing boundary holds (see landing:check).
 */
export function LandingChallenge(): React.ReactElement {
  return (
    <div className="landing-challenge">
      <p className="lc-setup">Everyone claims they can prompt.</p>
      <p className="lc-ask">Prove it.</p>
      <p className="lc-sub">Download the app and get scored.</p>
    </div>
  );
}

/**
 * Publishes the challenge to the left panel's stats slot while the
 * landing is showing; clears it on the way out so signed-in
 * routes own the slot. Renders nothing itself.
 */
export default function LandingStage(): React.ReactElement | null {
  const { setStats } = useMoonVisual();
  useEffect(() => {
    setStats(<LandingChallenge />);
    return () => {
      setStats(null);
    };
  }, [setStats]);
  return null;
}
