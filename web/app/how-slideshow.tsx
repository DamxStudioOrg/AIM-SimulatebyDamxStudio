"use client";

import { useEffect, useRef, useState } from "react";
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  CpuIcon,
  ListNumbersIcon,
  PauseIcon,
  PlayIcon,
  RobotIcon,
  ScalesIcon,
} from "@phosphor-icons/react";
import type { Icon } from "@phosphor-icons/react";
import gsap from "gsap";
import { slideParallax } from "@/lib/scroll-motion";
import { usePrefersReducedMotion } from "@/hooks/use-prefers-reduced-motion";
import { findScrollParent } from "@/hooks/use-scroll-highlight";

interface Slide {
  title: string;
  body: string;
  detail: string;
  icon: Icon;
}

const SLIDES: Slide[] = [
  {
    title: "Simulate your models in your own domain.",
    body: "Rehearse prompts in a controlled arena. Same seed plus same prompt always scores the same, so progress is measurable.",
    detail:
      "Bring local Ollama or LM Studio models, or connect hosted models with your own key. Practice prompting, watch how output changes, and build skill backed by scores.",
    icon: CpuIcon,
  },
  {
    title: "Compete",
    body: "Pit models against each other, run your own experiments, challenge friends to prompt duels, or watch simulation mode and learn from every outcome.",
    detail:
      "Track impact, efficiency, and token spend per turn. Compare runs side by side and refine prompts against numbers, not vibes.",
    icon: ScalesIcon,
  },

  {
    title: "Research, play, and community.",
    body: "Study prompting, test ideas, and compare models with analytical graphs — then share results with a community that plays to improve.",
    detail:
      "Prompt history, ghost races, leaderboards, and shareable duel codes keep practice fun. The desktop app adds offline play and local boards.",
    icon: ListNumbersIcon,
  },
];

const AUTOPLAY_MS = 6000;

export default function HowSlideshow(): React.ReactElement {
  const [index, setIndex] = useState(0);
  const [held, setHeld] = useState(false);
  const [hovering, setHovering] = useState(false);
  const [detailOpen, setDetailOpen] = useState(false);
  const paused = held || hovering || detailOpen;
  const root = useRef<HTMLDivElement>(null);
  const detailRef = useRef<HTMLParagraphElement>(null);
  const slideBody = useRef<HTMLDivElement>(null);
  const reducedMotion = usePrefersReducedMotion();
  const slide: Slide = SLIDES[index] ??
    SLIDES[0] ?? { title: "", body: "", detail: "", icon: RobotIcon };
  const SlideIcon = slide.icon;

  function go(next: number): void {
    const total = SLIDES.length;
    setDetailOpen(false);
    setIndex(((next % total) + total) % total);
  }

  useEffect(() => {
    if (paused) {
      return;
    }
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      return;
    }
    const timer = window.setInterval(() => {
      setIndex((current) => (current + 1) % SLIDES.length);
    }, AUTOPLAY_MS);
    return () => {
      window.clearInterval(timer);
    };
  }, [paused, index]);

  useEffect(() => {
    const host = root.current;
    if (host === null) {
      return;
    }
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      return;
    }
    const ctx = gsap.context(() => {
      gsap.fromTo(
        host.querySelectorAll("[data-slide-line]"),
        { y: 24, opacity: 0 },
        { y: 0, opacity: 1, duration: 0.5, ease: "power3.out", stagger: 0.09 },
      );
      const icon = host.querySelector("[data-slide-icon]");
      if (icon !== null) {
        gsap.fromTo(
          icon,
          { scale: 0.5, opacity: 0 },
          { scale: 1, opacity: 1, duration: 0.6, ease: "back.out(1.8)" },
        );
      }
    }, host);
    return () => {
      ctx.revert();
    };
  }, [index]);

  // Scroll-linked parallax: the slide rides slightly against the
  // planet's inner scroll and fades toward the rim. The transform
  // lands on the slide container so it composes with the per-line
  // entrances; autoplay, buttons, and keyboard are untouched.
  useEffect(() => {
    const body = slideBody.current;
    if (body === null) {
      return;
    }
    if (reducedMotion) {
      gsap.set(body, { clearProps: "transform,opacity" });
      return;
    }
    const scroller = findScrollParent(body);
    if (scroller === null) {
      return;
    }
    let raf = 0;
    const update = (): void => {
      raf = 0;
      const area = scroller.getBoundingClientRect();
      const box = body.getBoundingClientRect();
      if (area.height <= 0) {
        return;
      }
      const center = (box.top + box.bottom) / 2 - area.top;
      const style = slideParallax(center / area.height);
      gsap.set(body, { y: style.y, opacity: style.opacity });
    };
    const request = (): void => {
      if (raf === 0) {
        raf = requestAnimationFrame(update);
      }
    };
    scroller.addEventListener("scroll", request, { passive: true });
    window.addEventListener("resize", request);
    update();
    return () => {
      scroller.removeEventListener("scroll", request);
      window.removeEventListener("resize", request);
      if (raf !== 0) {
        cancelAnimationFrame(raf);
      }
      gsap.set(body, { clearProps: "transform,opacity" });
    };
  }, [reducedMotion, index, detailOpen]);

  useEffect(() => {
    const panel = detailRef.current;
    if (!detailOpen || panel === null) {
      return;
    }
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      return;
    }
    const tween = gsap.fromTo(
      panel,
      { x: -32, opacity: 0 },
      { x: 0, opacity: 1, duration: 0.45, ease: "power3.out" },
    );
    return () => {
      tween.kill();
    };
  }, [detailOpen, index]);

  useEffect(() => {
    function onKey(event: KeyboardEvent): void {
      if (event.key === "ArrowLeft") {
        go(index - 1);
      } else if (event.key === "ArrowRight") {
        go(index + 1);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
    };
  });

  return (
    <div
      ref={root}
      className="slideshow"
      onMouseEnter={() => {
        setHovering(true);
      }}
      onMouseLeave={() => {
        setHovering(false);
      }}
      onFocus={() => {
        setHovering(true);
      }}
      onBlur={() => {
        setHovering(false);
      }}
    >
      <div
        ref={slideBody}
        className="slide"
        role="group"
        aria-roledescription="slide"
        aria-label={`${String(index + 1)} of ${String(SLIDES.length)}: ${slide.title}`}
        data-highlight
      >
        <span className="slide-icon" data-slide-icon aria-hidden="true">
          <SlideIcon size={34} />
        </span>
        <h3 data-slide-line data-highlight-title>
          {slide.title}
        </h3>
        <p className="lede" data-slide-line>
          {slide.body}
        </p>
        <p>
          <button
            type="button"
            className="ghost"
            aria-expanded={detailOpen}
            aria-controls="how-slide-detail"
            onClick={() => {
              setDetailOpen((value) => !value);
            }}
          >
            {detailOpen ? "Hide details" : "Details"}
          </button>
        </p>
        {detailOpen && (
          <p id="how-slide-detail" className="slide-detail" ref={detailRef}>
            {slide.detail}
          </p>
        )}
      </div>
      <div className="slide-controls">
        <button
          type="button"
          className="ghost icon-button"
          aria-label="Previous slide"
          onClick={() => {
            go(index - 1);
          }}
        >
          <ArrowLeftIcon size={20} aria-hidden="true" />
        </button>
        <span className="slide-count" aria-hidden="true">
          {index + 1} / {SLIDES.length}
        </span>
        <button
          type="button"
          className="ghost icon-button"
          aria-label={held ? "Play slideshow" : "Pause slideshow"}
          aria-pressed={held}
          onClick={() => {
            setHeld((value) => !value);
          }}
        >
          {held ? (
            <PlayIcon size={20} aria-hidden="true" />
          ) : (
            <PauseIcon size={20} aria-hidden="true" />
          )}
        </button>
        <div className="slide-dots" role="tablist" aria-label="Slides">
          {SLIDES.map((entry, position) => (
            <button
              key={entry.title}
              type="button"
              role="tab"
              aria-selected={position === index}
              aria-label={`Go to slide ${String(position + 1)}: ${entry.title}`}
              className={position === index ? "dot-active" : undefined}
              onClick={() => {
                go(position);
              }}
            />
          ))}
        </div>
        <button
          type="button"
          className="ghost icon-button"
          aria-label="Next slide"
          onClick={() => {
            go(index + 1);
          }}
        >
          <ArrowRightIcon size={20} aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}
