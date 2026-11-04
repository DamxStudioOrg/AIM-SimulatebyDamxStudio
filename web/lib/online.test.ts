import { afterEach, describe, expect, it, vi } from "vitest";
import { isOffline } from "./online";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("isOffline", () => {
  it("is true only when the runtime explicitly reports offline", () => {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, "navigator");
    Object.defineProperty(globalThis, "navigator", {
      value: { onLine: false },
      configurable: true,
    });
    try {
      expect(isOffline()).toBe(true);
    } finally {
      if (descriptor === undefined) {
        delete (globalThis as Record<string, unknown>).navigator;
      } else {
        Object.defineProperty(globalThis, "navigator", descriptor);
      }
    }
  });

  it("counts unknown connectivity as online", () => {
    // Node leaves onLine undefined: guards must not trip in tests or odd UAs.
    expect(isOffline()).toBe(false);
  });

  it("counts a missing navigator as online", () => {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, "navigator");
    Object.defineProperty(globalThis, "navigator", {
      value: undefined,
      configurable: true,
    });
    try {
      expect(isOffline()).toBe(false);
    } finally {
      if (descriptor === undefined) {
        delete (globalThis as Record<string, unknown>).navigator;
      } else {
        Object.defineProperty(globalThis, "navigator", descriptor);
      }
    }
  });
});
