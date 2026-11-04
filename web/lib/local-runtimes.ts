/**
 * Local runtime bases: the LM Studio / Ollama addresses this device
 * probes for models. Device-local only (plain localStorage — no
 * secrets here, just URLs); blanks fall back to the conventional
 * loopback defaults.
 */

export type LocalRuntimeName = "lmstudio" | "ollama";

const KEYS: Record<LocalRuntimeName, string> = {
  lmstudio: "simulate.lmstudio",
  ollama: "simulate.ollama",
};

export const DEFAULT_RUNTIME_BASES: Record<LocalRuntimeName, string> = {
  lmstudio: "http://localhost:1234/v1",
  ollama: "http://localhost:11434/v1",
};

export function loadLocalRuntime(name: LocalRuntimeName): string {
  try {
    return window.localStorage.getItem(KEYS[name]) ?? DEFAULT_RUNTIME_BASES[name];
  } catch {
    return DEFAULT_RUNTIME_BASES[name];
  }
}

export function saveLocalRuntime(name: LocalRuntimeName, base: string): void {
  const clean = base.trim();
  try {
    if (clean === "" || clean === DEFAULT_RUNTIME_BASES[name]) {
      window.localStorage.removeItem(KEYS[name]);
    } else {
      window.localStorage.setItem(KEYS[name], clean);
    }
  } catch {
    // Blocked storage: the probe still runs with the typed values.
  }
}
