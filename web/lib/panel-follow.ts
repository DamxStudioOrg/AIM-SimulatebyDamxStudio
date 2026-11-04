/**
 * Left-panel follow: while a right-side section drives the published
 * visual, the panel's own scroller drifts through tall content in
 * proportion to the section's traversal — arriving at the top when
 * the section arrives, leaving at the bottom as it departs. Pure
 * progress math; the hook owns listeners, pinning, and motion
 * gating.
 */

/**
 * Target scroll offset for the panel, or null when there is nothing
 * to drift through (no overflow, no viewport, no section). Progress
 * runs 0 (section top at the viewport's bottom edge) to 1 (section
 * bottom at the viewport's top edge).
 */
export function followTarget(
  rectTop: number,
  rectHeight: number,
  viewportHeight: number,
  maxScroll: number,
): number | null {
  if (maxScroll <= 0 || viewportHeight <= 0 || rectHeight <= 0) {
    return null;
  }
  const travel = viewportHeight + rectHeight;
  const progress = (viewportHeight - rectTop) / travel;
  const clamped = Math.min(1, Math.max(0, progress));
  return clamped * maxScroll;
}
