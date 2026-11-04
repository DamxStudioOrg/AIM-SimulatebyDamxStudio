import { describe, expect, it } from "vitest";
import { HISTORY_KEY } from "./history";
import { GHOSTS_KEY, LEAGUES_KEY, RATINGS_KEY, TRIALS_KEY } from "./leagues";
import { SEALED_PROGRESS_KEYS } from "./progress-keys";

describe("SEALED_PROGRESS_KEYS", () => {
  it("covers every uid-sealed store readers unseal", () => {
    expect([...SEALED_PROGRESS_KEYS].sort()).toEqual(
      [HISTORY_KEY, LEAGUES_KEY, GHOSTS_KEY, RATINGS_KEY, TRIALS_KEY].sort(),
    );
  });
});
