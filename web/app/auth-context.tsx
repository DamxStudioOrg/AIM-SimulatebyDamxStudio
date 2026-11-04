"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { AuthContext } from "./use-auth";
import type { AuthContextValue } from "./use-auth";
import {
  DISPLAY_NAME_KEY,
  isAuthStorageBlocked,
  normalizeDisplayName,
  parseAuthState,
  probeAuthStorage,
  readAuthFlags,
  writeAuthFlags,
} from "@/lib/auth";
import type { AuthState } from "@/lib/auth";
import { SEALED_PROGRESS_KEYS } from "@/lib/progress-keys";
import { resealStores } from "@/lib/sealed-store";
import { getOrCreateUid, restoreUid } from "@/lib/vault";

function readState(): AuthState {
  return parseAuthState(readAuthFlags());
}

export function AuthProvider({
  children,
}: Readonly<{ children: ReactNode }>): React.ReactElement {
  const [state, setState] = useState<AuthState>("signed-out");
  const [durable, setDurable] = useState(true);
  const [displayName, setDisplayNameState] = useState<string | null>(null);
  const [uid, setUid] = useState("");

  useEffect(() => {
    setState(readState());
    setDurable(probeAuthStorage());
    setUid(getOrCreateUid());
    try {
      setDisplayNameState(
        normalizeDisplayName(window.localStorage.getItem(DISPLAY_NAME_KEY) ?? ""),
      );
    } catch {
      setDisplayNameState(null);
    }
  }, []);

  const continueAsGuest = useCallback(() => {
    // Optimistic: the write lands in memory first, so a blocked
    // store still signs in for the session instead of a dead button.
    writeAuthFlags({ guest: "1", signedOut: null });
    setDurable(!isAuthStorageBlocked());
    setState("guest");
  }, []);

  const setDisplayName = useCallback((name: string) => {
    const clean = normalizeDisplayName(name);
    try {
      if (clean === null) {
        window.localStorage.removeItem(DISPLAY_NAME_KEY);
      } else {
        window.localStorage.setItem(DISPLAY_NAME_KEY, clean);
      }
    } catch {
      // A blocked store must not break the local account UI.
    }
    setDisplayNameState(clean);
  }, []);

  const adoptUid = useCallback(async (next: string) => {
    const prev = getOrCreateUid();
    if (!restoreUid(next)) {
      return false;
    }
    setUid(next);
    if (prev !== next) {
      await resealStores(window.localStorage, SEALED_PROGRESS_KEYS, prev, next);
    }
    return true;
  }, []);

  const signOut = useCallback(() => {
    writeAuthFlags({ guest: null, signedOut: "1" });
    setDurable(!isAuthStorageBlocked());
    setState("signed-out");
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      state,
      signedIn: state !== "signed-out",
      durable,
      displayName,
      uid,
      continueAsGuest,
      setDisplayName,
      adoptUid,
      signOut,
    }),
    [
      state,
      durable,
      displayName,
      uid,
      continueAsGuest,
      setDisplayName,
      adoptUid,
      signOut,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

// Re-exported so existing consumers keep importing from the provider
// module; landing-graph components import ./use-auth directly.
export { useAuth } from "./use-auth";
export type { AuthContextValue } from "./use-auth";
