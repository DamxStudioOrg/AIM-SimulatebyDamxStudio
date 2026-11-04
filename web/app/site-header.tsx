"use client";

import { useRef } from "react";
import { link } from "@/lib/routing";
import { useAuth } from "./auth-context";
import { MoonStatsSlot, MoonStage } from "./moon-visual";
import { usePanelFollow } from "./use-panel-follow";

// Brand-only header: the logo mark links home for signed-out
// visitors and the operator console once signed in. No wordmark,
// no buttons, no controls. Signed-in routes publish a record strip
// and a scroll-driven visual (stages, graphs) below the mark; the
// panel scrolls when they overflow the square. Routes with no
// visual publish their page title instead; the landing keeps the
// bare moon. Sign-in happens in the console gate; downloads live
// on the landing planet.
export default function SiteHeader(): React.ReactElement {
  const auth = useAuth();
  const target = auth.signedIn ? link("console") : link("home");
  const label = auth.signedIn ? "operator console" : "home";
  const scrollRef = useRef<HTMLDivElement | null>(null);
  usePanelFollow(scrollRef);
  return (
    <header className="site-header">
      <div className="visual-scroll" ref={scrollRef}>
        <p className="brand">
          <a href={target} aria-label={`Simulate by Damx Studio — ${label}`}>
            <img src="/logo.png" alt="" width={48} height={48} className="brand-mark" />
          </a>
        </p>
        <MoonStatsSlot />
        <MoonStage />
      </div>
    </header>
  );
}
