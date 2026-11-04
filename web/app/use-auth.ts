"use client";

import { createContext, useContext } from "react";

/**
 * Auth context handle, dependency-free on purpose: landing-graph
 * components (the planet shell) read sign-in state through this
 * module without dragging the vault, sealed store, or history
 * chains along. The provider lives in ./auth-context.
 */
export interface AuthContextValue {
  // Mirrors lib/auth AuthState structurally (that module is
  // deny-listed from the landing graph, so this file must not
  // import it — keep the union in sync by hand).
  state: "signed-out" | "guest";
  signedIn: boolean;
  /** False when storage throws: the session works until quit. */
  durable: boolean;
  displayName: string | null;
  uid: string;
  continueAsGuest: () => void;
  setDisplayName: (name: string) => void;
  adoptUid: (uid: string) => Promise<boolean>;
  signOut: () => void;
}

export const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (value === null) {
    throw new Error("useAuth must be used inside <AuthProvider>");
  }
  return value;
}
