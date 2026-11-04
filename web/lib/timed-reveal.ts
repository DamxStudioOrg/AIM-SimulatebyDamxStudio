/** Revealed secrets hide themselves after this long. */
export const REVEAL_TIMEOUT_MS = 15_000;

export interface TimedReveal {
  readonly visible: boolean;
  reveal(): void;
  hide(): void;
  dispose(): void;
}

/**
 * Click-to-reveal state with auto-hide. Re-clicking re-arms the timer;
 * hide() masks immediately and cancels the pending auto-hide.
 */
export function createTimedReveal(
  notify: (visible: boolean) => void,
  timeoutMs: number = REVEAL_TIMEOUT_MS,
): TimedReveal {
  let visible = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  function clear(): void {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  }

  function show(next: boolean): void {
    if (visible === next) {
      return;
    }
    visible = next;
    notify(next);
  }

  return {
    get visible(): boolean {
      return visible;
    },
    reveal(): void {
      show(true);
      clear();
      timer = setTimeout(() => {
        timer = null;
        show(false);
      }, timeoutMs);
    },
    hide(): void {
      clear();
      show(false);
    },
    dispose(): void {
      clear();
    },
  };
}
