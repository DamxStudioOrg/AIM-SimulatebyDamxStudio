/** PNG export for the canvas stages (2D canvases stay readable, so
no preserved buffer is needed). Filename logic is unit-tested; the
download itself is thin DOM code, verified in a real browser. */

export type ExportGame = "city" | "tote";

export function exportFilename(game: ExportGame, seed: number): string {
  return `simulate-${game}-seed${String(seed)}.png`;
}

export function downloadCanvasPng(
  canvas: HTMLCanvasElement | null,
  filename: string,
): void {
  if (canvas === null) {
    return;
  }
  const link = document.createElement("a");
  link.href = canvas.toDataURL("image/png");
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
}

/** Filename for an animated replay recording of one stage. */
export function exportVideoFilename(game: ExportGame, seed: number): string {
  return `simulate-${game}-seed${String(seed)}.webm`;
}

const REPLAY_FPS = 30;

/**
 * Record a canvas as WebM for `durationMs` while the caller drives
 * the replay clock; resolves false when recording is unsupported.
 * Browser-only (MediaRecorder); the filename logic is unit-tested.
 */
export function recordCanvasWebm(
  canvas: HTMLCanvasElement | null,
  filename: string,
  durationMs: number,
): Promise<boolean> {
  if (canvas === null || typeof MediaRecorder === "undefined") {
    return Promise.resolve(false);
  }
  const stream = canvas.captureStream(REPLAY_FPS);
  const recorder = new MediaRecorder(stream, { mimeType: "video/webm" });
  const chunks: Blob[] = [];
  recorder.addEventListener("dataavailable", (event) => {
    if (event.data.size > 0) chunks.push(event.data);
  });
  return new Promise((resolve) => {
    recorder.addEventListener("stop", () => {
      const blob = new Blob(chunks, { type: "video/webm" });
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(link.href);
      resolve(true);
    });
    recorder.start();
    window.setTimeout(() => {
      if (recorder.state !== "inactive") recorder.stop();
    }, durationMs);
  });
}
