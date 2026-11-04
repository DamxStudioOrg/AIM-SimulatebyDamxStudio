"use client";

import type { ReactNode } from "react";
import { useAuth } from "./auth-context";
import NavPanel from "./nav-panel";
import PlanetPanel from "./planet-panel";
import SigninGate from "./signin-gate";

/**
 * Shared signed-in route shell: the gate for signed-out visitors,
 * else the nav pills plus the page. Every console-side route uses
 * this so gating and cross-navigation stay uniform.
 */
export default function RouteShell({
  gateHeadingId,
  gateTitle,
  gateHint,
  children,
}: Readonly<{
  gateHeadingId: string;
  gateTitle: string;
  gateHint: string;
  children: ReactNode;
}>): React.ReactElement {
  const auth = useAuth();
  return (
    <main className="console-page">
      <PlanetPanel enabled>
        <div className="shell">
          {!auth.signedIn ? (
            <SigninGate headingId={gateHeadingId} title={gateTitle} hint={gateHint} />
          ) : (
            <>
              <NavPanel />
              <div className="shell-main">{children}</div>
            </>
          )}
        </div>
      </PlanetPanel>
    </main>
  );
}
