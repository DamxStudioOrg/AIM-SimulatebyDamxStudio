/** Per-model health/readiness labels for the model picker. */

export type ModelHealthState = "ready-local" | "ready-key" | "needs-key";

export interface ModelHealth {
  state: ModelHealthState;
  label: string;
}

/**
 * Local models appear in the contract only when the sim detected the
 * runtime, so listing is the health signal. Hosted models are ready
 * when a key is saved on this device.
 */
export function modelHealth(kind: string, keySaved: boolean): ModelHealth {
  if (kind === "local") {
    return {
      state: "ready-local",
      label: "Reachable — detected by the sim on this device",
    };
  }
  if (keySaved) {
    return { state: "ready-key", label: "Ready — key saved on this device" };
  }
  return { state: "needs-key", label: "Needs a key — save one under Connect a bot" };
}
