"use client";

import { useState, type ReactNode } from "react";
import { useScrollHighlight } from "@/hooks/use-scroll-highlight";

/**
 * Mount point for the scroll-linked text highlight on server-rendered
 * pages: observes `[data-highlight]` descendants and keeps `.is-lit`
 * on the passage being read. `display: contents` keeps the panel's
 * child selectors and centering exactly as if it were not there.
 */
export default function ScrollHighlightScope({
  children,
}: Readonly<{ children: ReactNode }>): React.ReactElement {
  const [scope, setScope] = useState<HTMLDivElement | null>(null);
  useScrollHighlight(scope);
  return (
    <div className="highlight-scope" ref={setScope}>
      {children}
    </div>
  );
}
