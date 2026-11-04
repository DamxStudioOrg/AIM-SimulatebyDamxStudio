"use client";

import { useEffect } from "react";

export const SW_UPDATE_EVENT = "aim-sw-update";

export default function SwRegister(): null {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") {
      return;
    }
    if (!("serviceWorker" in navigator)) {
      return;
    }
    // Desktop shell: the console talks to a local server over the
    // preload bridge, so an offline cache buys nothing and risks
    // booting a stale shell after an app update. Heal profiles that
    // registered the worker under the web build: unregister + purge,
    // then never register again here.
    const bridge = (window as unknown as Record<string, unknown>).SimulatebyDamxStudio;
    if (bridge !== undefined) {
      void navigator.serviceWorker
        .getRegistrations()
        .then((registrations) =>
          Promise.all(registrations.map((entry) => entry.unregister())),
        )
        .then(() => caches.keys())
        .then((keys) => Promise.all(keys.map((key) => caches.delete(key))))
        .catch(() => undefined);
      return;
    }
    let checkForUpdate: (() => void) | null = null;
    const announce = (): void => {
      window.dispatchEvent(new CustomEvent(SW_UPDATE_EVENT));
    };
    const onVisibility = (): void => {
      checkForUpdate?.();
    };
    document.addEventListener("visibilitychange", onVisibility);
    void navigator.serviceWorker
      .register("/sw.js")
      .then((registration) => {
        checkForUpdate = () => {
          if (document.visibilityState === "visible") {
            void registration.update().catch(() => undefined);
          }
        };
        registration.addEventListener("updatefound", () => {
          const worker = registration.installing;
          if (worker === null) {
            return;
          }
          worker.addEventListener("statechange", () => {
            if (
              worker.state === "installed" &&
              navigator.serviceWorker.controller !== null
            ) {
              announce();
            }
          });
        });
      })
      .catch(() => undefined);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);
  return null;
}
