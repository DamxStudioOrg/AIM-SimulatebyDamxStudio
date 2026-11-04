"use client";

import { useEffect } from "react";
import gsap from "gsap";

const CTA_SELECTOR = '[data-fx="cta"]';
const PRESS_SELECTOR = "button, a.button";

/**
 * App-wide GSAP layer: CTA buttons fade in with a small scale pop
 * and every button press gets a subtle squash. Reduced motion
 * skips all.
 */
export default function MotionFx(): null {
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      return;
    }
    const played = new WeakSet<Element>();

    function playCta(el: Element): void {
      if (played.has(el)) {
        return;
      }
      played.add(el);
      gsap.fromTo(
        el,
        { opacity: 0, scale: 0.92 },
        {
          opacity: 1,
          scale: 1,
          duration: 0.55,
          ease: "back.out(1.7)",
          clearProps: "opacity,transform",
        },
      );
    }
    function scan(scope: Element): void {
      if (scope.matches(CTA_SELECTOR)) {
        playCta(scope);
      }
      scope.querySelectorAll(CTA_SELECTOR).forEach(playCta);
    }
    scan(document.body);
    const observer = new MutationObserver((records) => {
      for (const record of records) {
        record.addedNodes.forEach((node) => {
          if (node instanceof Element) {
            scan(node);
          }
        });
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });

    let pressed: Element | null = null;
    function onDown(event: PointerEvent): void {
      const target = (event.target as Element).closest(PRESS_SELECTOR);
      if (target == null) {
        return;
      }
      pressed = target;
      gsap.to(target, {
        scale: 0.96,
        duration: 0.12,
        ease: "power2.out",
        overwrite: "auto",
      });
    }
    function onUp(): void {
      if (pressed === null) {
        return;
      }
      gsap.to(pressed, {
        scale: 1,
        duration: 0.3,
        ease: "elastic.out(1, 0.5)",
        overwrite: "auto",
        clearProps: "transform",
      });
      pressed = null;
    }
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("pointerup", onUp);
    document.addEventListener("pointercancel", onUp);

    return () => {
      observer.disconnect();
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("pointerup", onUp);
      document.removeEventListener("pointercancel", onUp);
    };
  }, []);
  return null;
}
