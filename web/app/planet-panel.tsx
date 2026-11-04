"use client";

import type { ReactNode } from "react";
import { link } from "@/lib/routing";
import { useAuth } from "./use-auth";

/**
 * Governing panel for all planet content. Every page that displays
 * inside the planet renders as a child of this panel, so nothing can
 * display outside the planet's outer boundary: the panel owns the
 * rim inset, the centered column, and horizontal clipping.
 *
 * The panel also has sole authority over how its objects are
 * displayed and aligned — the Docs alignment (centered column,
 * centralized titles and writeups) is its default for every page.
 * Children only display their writeups and buttons on it; they do
 * not govern layout or alignment.
 *
 * Enable/disable follows the gaming convention: an enabled panel
 * renders its children inside the boundary; a disabled panel renders
 * nothing at all (children unmounted, panel hidden), never a
 * greyed-out copy left on the planet.
 *
 * The bottom logo mirrors the header mark: home for signed-out
 * visitors, the operator console once signed in.
 */
export default function PlanetPanel({
  enabled = true,
  children,
}: Readonly<{ enabled?: boolean; children?: ReactNode }>): React.ReactElement {
  const auth = useAuth();
  if (!enabled) {
    return (
      <div className="planet-panel" data-enabled="false" hidden aria-hidden="true" />
    );
  }
  const target = auth.signedIn ? link("console") : link("home");
  const label = auth.signedIn ? "Back to the console" : "Back to home";
  return (
    <div className="planet-panel" data-enabled="true">
      {children}
      <a href={target} className="planet-home-btn" aria-label={label}>
        <img
          src="/logo.png"
          alt=""
          width={40}
          height={40}
          className="planet-home-logo"
        />
      </a>
    </div>
  );
}
