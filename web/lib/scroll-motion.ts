/**
 * Pure scroll-motion math for the landing slideshow parallax and the
 * scroll-linked text highlight. DOM-free so the rules stay unit-testable;
 * hooks translate live measurements into these inputs.
 */

/** Slide drift and fade for one scroll position. */
export interface ParallaxStyle {
  /** Vertical drift in px: slides ride slightly against the scroll. */
  y: number;
  /** Edge fade: full at center, dimmed toward the container rim. */
  opacity: number;
}

const DRIFT_PX = 28;
const FADE_BAND = 0.18;
const MIN_OPACITY = 0.35;

/**
 * Parallax for a block whose center sits at `centerRatio` of the scroll
 * container's viewport (0 = top edge, 0.5 = dead center, 1 = bottom
 * edge). Out-of-range ratios clamp instead of flinging the slide.
 */
export function slideParallax(centerRatio: number): ParallaxStyle {
  const ratio = Math.min(1, Math.max(0, centerRatio));
  const y = (0.5 - ratio) * DRIFT_PX;
  const edge = Math.min(ratio, 1 - ratio) / FADE_BAND;
  const opacity = MIN_OPACITY + (1 - MIN_OPACITY) * Math.min(1, Math.max(0, edge));
  return { y, opacity };
}

/** One highlight block's latest observer reading. */
export interface LitCandidate {
  id: string;
  ratio: number;
  visible: boolean;
}

/**
 * Most-visible-wins highlight: the visible block with the highest
 * intersection ratio lights up. Ties keep the earliest block (stable,
 * no flicker between equals); nothing visible lights nothing.
 */
export function pickLitId(blocks: LitCandidate[]): string | null {
  let lit: string | null = null;
  let best = -1;
  for (const block of blocks) {
    if (!block.visible) {
      continue;
    }
    if (block.ratio > best) {
      best = block.ratio;
      lit = block.id;
    }
  }
  return lit;
}
