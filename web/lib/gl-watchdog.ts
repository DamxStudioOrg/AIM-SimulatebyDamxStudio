/**
 * First-frame watchdog: some broken GL stacks hand back a context
 * that draws nothing without throwing or firing webglcontextlost
 * (sandboxed or disabled GPU). The canvas then sits black forever
 * with no error and no notice. After a grace window this samples
 * the presented frame: a healthy stage always lights most of it
 * (the moon disc fills the view), so a dark readback means the
 * canvas is dead. Needs preserveDrawingBuffer on the stage canvas.
 */

export interface FrameWatch {
  stop(): void;
}

/**
 * True when under 2% of pixels read lit. Pure over RGBA bytes so
 * node tests can pin it without a DOM.
 */
export function isDarkFrame(data: ArrayLike<number>, litThreshold = 0.02): boolean {
  const pixels = Math.floor(data.length / 4);
  if (pixels === 0) {
    return true;
  }
  let lit = 0;
  for (let i = 0; i < data.length; i += 4) {
    const red = data[i] ?? 0;
    const green = data[i + 1] ?? 0;
    const blue = data[i + 2] ?? 0;
    const alpha = data[i + 3] ?? 0;
    if (red + green + blue > 45 && alpha > 16) {
      lit += 1;
    }
  }
  return lit / pixels < litThreshold;
}

/**
 * Sample the canvas once after the grace window; call onDark when
 * the presented frame reads dark. Never trips when verification
 * itself is impossible (no 2D context); an unreadable canvas reads
 * as unusable. Stop the watch on unmount.
 */
export function watchFirstFrame(
  canvas: HTMLCanvasElement,
  onDark: () => void,
  timeoutMs = 4000,
): FrameWatch {
  const timer = window.setTimeout(() => {
    let dark: boolean;
    try {
      const sample = document.createElement("canvas");
      sample.width = 48;
      sample.height = 48;
      const ctx = sample.getContext("2d");
      if (ctx === null) {
        return;
      }
      ctx.drawImage(canvas, 0, 0, 48, 48);
      dark = isDarkFrame(ctx.getImageData(0, 0, 48, 48).data);
    } catch {
      dark = true;
    }
    if (dark) {
      onDark();
    }
  }, timeoutMs);
  return {
    stop: () => {
      window.clearTimeout(timer);
    },
  };
}
