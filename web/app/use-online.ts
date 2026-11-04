"use client";

import { useEffect, useState } from "react";

/** Live browser connectivity; false only when the browser knows it's offline. */
export function useOnline(): boolean {
  const [online, setOnline] = useState(true);

  useEffect(() => {
    setOnline(navigator.onLine);
    const markOnline = (): void => {
      setOnline(true);
    };
    const markOffline = (): void => {
      setOnline(false);
    };
    window.addEventListener("online", markOnline);
    window.addEventListener("offline", markOffline);
    return () => {
      window.removeEventListener("online", markOnline);
      window.removeEventListener("offline", markOffline);
    };
  }, []);

  return online;
}
