/**
 * Onboarding tour: one card that walks every signed-in page.
 * First-run shows start on the visitor's own page; advancing
 * across a page boundary navigates, and each step scrolls its
 * anchor into view when it has one. Dismissal persists via
 * simulate.tourSeen; the Account page restarts it any time via
 * the start event. Copy and steps live in lib/tour.
 */
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Button } from "@/components/base/buttons/button";
import { parseAuthState, readAuthFlags } from "@/lib/auth";
import {
  TOUR_START_EVENT,
  TOUR_STEPS,
  firstStepForPage,
  markTourSeen,
  tourSeen,
} from "@/lib/tour";

export default function TourOverlay(): React.ReactElement | null {
  const router = useRouter();
  const pathname = usePathname();
  const [visible, setVisible] = useState(false);
  const [index, setIndex] = useState(0);
  const cardRef = useRef<HTMLDivElement | null>(null);

  const goTo = useCallback(
    (next: number): void => {
      const clamped = Math.min(Math.max(next, 0), TOUR_STEPS.length - 1);
      setIndex(clamped);
      const step = TOUR_STEPS[clamped];
      if (step !== undefined && step.page !== window.location.pathname) {
        router.push(step.page);
      }
    },
    [router],
  );

  const close = useCallback((): void => {
    markTourSeen();
    setVisible(false);
  }, []);

  // First run only: signed-in, unseen, and not on the marketing
  // landing (the tour's pages all live behind the gate).
  useEffect(() => {
    if (window.location.pathname === "/") {
      return;
    }
    if (parseAuthState(readAuthFlags()) === "signed-out") {
      return;
    }
    if (tourSeen()) {
      return;
    }
    setIndex(firstStepForPage(window.location.pathname));
    setVisible(true);
  }, []);

  // Restart from Account: from the top, console first, seen or not.
  useEffect(() => {
    const onStart = (): void => {
      setIndex(0);
      setVisible(true);
      const first = TOUR_STEPS[0];
      if (first !== undefined && first.page !== window.location.pathname) {
        router.push(first.page);
      }
    };
    window.addEventListener(TOUR_START_EVENT, onStart);
    return () => {
      window.removeEventListener(TOUR_START_EVENT, onStart);
    };
  }, [router]);

  // Bring the step's anchor into view once its page is showing.
  // Targets mount async (the picker waits on unlocks), so retry
  // briefly, then leave the page where it is.
  useEffect(() => {
    if (!visible) {
      return;
    }
    const step = TOUR_STEPS[index];
    if (step?.selector === undefined || pathname !== step.page) {
      return;
    }
    const selector = step.selector;
    let tries = 0;
    let timer = 0;
    const attempt = (): void => {
      const target = document.querySelector(selector);
      if (target instanceof HTMLElement) {
        const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        target.scrollIntoView({
          block: "center",
          behavior: reduced ? "auto" : "smooth",
        });
        return;
      }
      tries += 1;
      if (tries < 12) {
        timer = window.setTimeout(attempt, 120);
      }
    };
    timer = window.setTimeout(attempt, 60);
    return () => {
      window.clearTimeout(timer);
    };
  }, [visible, index, pathname]);

  // Escape dismisses like Skip; the card takes focus on open.
  useEffect(() => {
    if (!visible) {
      return;
    }
    cardRef.current?.focus();
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        close();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
    };
  }, [visible, close]);

  if (!visible) {
    return null;
  }
  const step = TOUR_STEPS[index] ?? TOUR_STEPS[0];
  if (step === undefined) {
    return null;
  }
  const last = index >= TOUR_STEPS.length - 1;
  return (
    <div
      className="tour-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="Onboarding tour"
    >
      <div className="tour-card" ref={cardRef} tabIndex={-1}>
        <p className="tour-meta">
          {step.pageLabel} · Step {String(index + 1)} of {String(TOUR_STEPS.length)}
        </p>
        <h2>{step.title}</h2>
        <p>{step.desc}</p>
        <div className="tour-dots" aria-hidden="true">
          {TOUR_STEPS.map((entry, dot) => (
            <span key={entry.id} className={dot === index ? "dot active" : "dot"} />
          ))}
        </div>
        <div className="tour-controls">
          <Button variant="ghost" onClick={close}>
            Skip
          </Button>
          <span className="tour-spacer" />
          {index > 0 && (
            <Button
              variant="ghost"
              onClick={() => {
                goTo(index - 1);
              }}
            >
              Back
            </Button>
          )}
          {last ? (
            <Button variant="primary" onClick={close}>
              Done
            </Button>
          ) : (
            <Button
              variant="primary"
              onClick={() => {
                goTo(index + 1);
              }}
            >
              Next
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
