import { HISTORY_KEY } from "./history";
import { GHOSTS_KEY, LEAGUES_KEY, RATINGS_KEY, TRIALS_KEY } from "./leagues";

/**
 * Every localStorage key sealed under the arena ID. Adopting an ID
 * re-seals exactly these keys onto it: a sealed key missing here
 * strands its progress under the previous ID, and a plaintext key
 * listed here would seal into unreadability. Keep in sync with the
 * loadSealedText/sealText call sites.
 */
export const SEALED_PROGRESS_KEYS: readonly string[] = [
  HISTORY_KEY,
  LEAGUES_KEY,
  GHOSTS_KEY,
  RATINGS_KEY,
  TRIALS_KEY,
];
