/**
 * Dataset sandbox client: talks to the Electron preload bridge
 * (`window.SimulatebyDamxStudio.datasets`) when the console runs in
 * the desktop shell, and degrades to null on plain web. The bridge
 * only ever returns sandbox manifests — every run reads the
 * workspace copy, never the user's source directory.
 */

export type DatasetFileKind = "tabular" | "text" | "image" | "model3d" | "other";

export interface DatasetFile {
  rel: string;
  size: number;
  kind: DatasetFileKind;
}

export interface DatasetManifest {
  id: string;
  /** Read-only source path (display only; runs must not read it). */
  source: string;
  /** Sandboxed workspace copy every run reads. */
  root: string;
  importedAt: string;
  files: DatasetFile[];
  summary: {
    count: number;
    bytes: number;
    byKind: Record<DatasetFileKind, number>;
  };
}

export interface DatasetBridge {
  pick: () => Promise<string | null>;
  /**
   * Import the dialog-picked folder. Takes no path: main imports the
   * folder the dialog just returned, one-shot, so the renderer can
   * never name an arbitrary source.
   */
  import: () => Promise<DatasetManifest>;
  get: (id: string) => Promise<DatasetManifest>;
  remove: (id: string) => Promise<boolean>;
}

/** Preload bridge when hosted in Electron, null on plain web/SSR. */
export function datasetBridge(): DatasetBridge | null {
  if (typeof window === "undefined") {
    return null;
  }
  const exposed = (window as unknown as Record<string, unknown>).SimulatebyDamxStudio;
  if (exposed === null || typeof exposed !== "object") {
    return null;
  }
  const nested = (exposed as Record<string, unknown>).datasets;
  if (nested === null || typeof nested !== "object") {
    return null;
  }
  return nested as DatasetBridge;
}

const BYTE_UNITS = ["B", "KB", "MB", "GB"] as const;

/** Human file size: 900 B, 1.2 KB, 3.4 MB. */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) {
    return "0 B";
  }
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < BYTE_UNITS.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const rounded = unit === 0 ? String(Math.round(value)) : value.toFixed(1);
  const suffix = BYTE_UNITS[unit] ?? "B";
  return `${rounded} ${suffix}`;
}

/** /api/assets prompt limit — the builder never exceeds it. */
export const ASSET_PROMPT_MAX = 2000;

/**
 * Asset-draft prompt for a dataset: the user's brief plus the
 * sandboxed file list (rel path, kind, size). The list fills whatever
 * budget the brief leaves under the API limit; overflow files fold
 * into an "…and N more" line so the call is never rejected for size.
 */
export function buildAssetPrompt(
  brief: string,
  files: DatasetFile[],
  selected?: readonly string[],
): string {
  const wanted = selected === undefined ? null : new Set(selected);
  const listed = files.filter((file) => wanted === null || wanted.has(file.rel));
  const header = "Dataset files (sandboxed copy; describe dressing for them):";
  const lines = listed.map(
    (file) => `- ${file.rel} (${file.kind}, ${formatBytes(file.size)})`,
  );
  const clipped = brief.trim().slice(0, ASSET_PROMPT_MAX);
  const budget = ASSET_PROMPT_MAX - clipped.length - header.length - 4;
  const kept: string[] = [];
  let used = 0;
  for (const line of lines) {
    if (used + line.length + 1 > budget) {
      break;
    }
    kept.push(line);
    used += line.length + 1;
  }
  const dropped = lines.length - kept.length;
  const appendix =
    kept.length === 0 && dropped === 0
      ? ""
      : `\n\n${header}\n${kept.join("\n")}${dropped > 0 ? `\n…and ${String(dropped)} more` : ""}`;
  return `${clipped}${appendix}`.slice(0, ASSET_PROMPT_MAX);
}
