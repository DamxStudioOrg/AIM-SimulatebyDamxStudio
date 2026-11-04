/** Which world fills the single center viewport. */
export type StageMode = "simulation" | "controls";

/** On-device slot for the viewport mode (mirrors the auth keys). */
export const STAGE_MODE_KEY = "aim-arena-mode";

/** The console is home: first paint shows Controls. */
export const DEFAULT_STAGE_MODE: StageMode = "controls";

/** Stored values outside the union fall back to the default. */
export function parseStageMode(value: unknown): StageMode {
  return value === "simulation" || value === "controls" ? value : DEFAULT_STAGE_MODE;
}
