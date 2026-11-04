"use client";

import { useEffect, useState } from "react";

/**
 * Live prefers-reduced-motion flag. Shared by the slideshow parallax,
 * the chart morphs, and the count-up headlines so every animation in
 * the app answers one motion switch. SSR-safe: false until measured.
 */
export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(query.matches);
    const onChange = (event: MediaQueryListEvent): void => {
      setReduced(event.matches);
    };
    query.addEventListener("change", onChange);
    return () => {
      query.removeEventListener("change", onChange);
    };
  }, []);

  return reduced;
}
