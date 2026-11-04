export type AuthState = "signed-out" | "guest";

export const GUEST_KEY = "aim-arena-guest";
/** Explicit-logout marker: only this flag shows the gate. First-run
   users (neither flag) auto-login — local data already exists. */
export const SIGNED_OUT_KEY = "aim-arena-signed-out";
export const DISPLAY_NAME_KEY = "aim-arena-name";
export const DISPLAY_NAME_MAX = 24;
export const BOT_NICKNAME_KEY = "aim-arena-bot";
export const BOT_NICKNAME_MAX = 24;

interface StoredAuthFlags {
  guest: string | null;
  signedOut: string | null;
}

export function parseAuthState(flags: StoredAuthFlags): AuthState {
  if (flags.guest === "1") {
    return "guest";
  }
  if (flags.signedOut === "1") {
    return "signed-out";
  }
  return "guest";
}

/**
 * In-memory flag fallback: when storage throws (private mode, a
 * broken profile — the desktop app once shipped a dead Create
 * button this way), the session still works until quit. Writes
 * always land here first; reads fall back here on throw.
 */
const memoryFlags: StoredAuthFlags = { guest: null, signedOut: null };
let storageBlocked = false;

export function readAuthFlags(): StoredAuthFlags {
  try {
    return {
      guest: window.localStorage.getItem(GUEST_KEY),
      signedOut: window.localStorage.getItem(SIGNED_OUT_KEY),
    };
  } catch {
    storageBlocked = true;
    return { ...memoryFlags };
  }
}

export function writeAuthFlags(next: StoredAuthFlags): void {
  memoryFlags.guest = next.guest;
  memoryFlags.signedOut = next.signedOut;
  try {
    if (next.guest === null) {
      window.localStorage.removeItem(GUEST_KEY);
    } else {
      window.localStorage.setItem(GUEST_KEY, next.guest);
    }
    if (next.signedOut === null) {
      window.localStorage.removeItem(SIGNED_OUT_KEY);
    } else {
      window.localStorage.setItem(SIGNED_OUT_KEY, next.signedOut);
    }
  } catch {
    storageBlocked = true;
  }
}

/** False once any flag read or write has thrown. */
export function isAuthStorageBlocked(): boolean {
  return storageBlocked;
}

/** Test-write probe for mount: true when a write round-trips. */
export function probeAuthStorage(): boolean {
  try {
    window.localStorage.setItem("aim-arena-probe", "1");
    window.localStorage.removeItem("aim-arena-probe");
    return true;
  } catch {
    storageBlocked = true;
    return false;
  }
}

/** Local-only display name: trimmed, blank means unset, capped in length. */
export function normalizeDisplayName(raw: string): string | null {
  const clean = raw.trim();
  if (clean === "") {
    return null;
  }
  return clean.slice(0, DISPLAY_NAME_MAX);
}

/** Bot nickname: same shape as a display name, but sent with submissions. */
export function normalizeBotNickname(raw: string): string | null {
  const clean = raw.trim();
  if (clean === "") {
    return null;
  }
  return clean.slice(0, BOT_NICKNAME_MAX);
}

/** Saved bot nickname, if any; null when unset or storage is blocked. */
export function readBotNickname(): string | null {
  try {
    return normalizeBotNickname(window.localStorage.getItem(BOT_NICKNAME_KEY) ?? "");
  } catch {
    return null;
  }
}
