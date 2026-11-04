/**
 * Uid-sealed local progress: history, challenge completions, leagues,
 * ghosts, and ratings are AES-GCM ciphertexts keyed by the user's
 * random arena ID (PBKDF2 over a per-device salt). Plaintext values
 * found in an unlocked store auto-migrate on first read; sealed
 * values that won't open under the current ID are left untouched
 * (locked, never overwritten) so adopting the right ID recovers
 * them. Callers pass an explicit store plus `getOrCreateUid()`:
 * window-free and fully unit-testable with a Map-backed fake.
 *
 * Honest limits: the ID sits on the device next to the ciphertext,
 * so this stops casual at-rest reads and binds exports to the ID —
 * it is not a vault against a determined profile reader (provider
 * keys keep their stronger non-extractable device key). Lose the
 * ID and the sealed progress is unrecoverable by design; the
 * account recovery card says so plainly.
 */

const SALT_KEY = "aim-arena-seal-salt";
const PBKDF2_ITERATIONS = 120_000;

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface SealedEnvelope {
  v: 1;
  iv: string;
  data: string;
}

export function isSealedEnvelope(value: unknown): value is SealedEnvelope {
  return isEnvelope(value);
}

function isEnvelope(value: unknown): value is SealedEnvelope {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return (
    candidate.v === 1 &&
    typeof candidate.iv === "string" &&
    typeof candidate.data === "string"
  );
}

function cryptoRef(): Crypto {
  return globalThis.crypto;
}

function randomBytes(length: number): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(new ArrayBuffer(length));
  cryptoRef().getRandomValues(bytes);
  return bytes;
}

function b64encode(bytes: Uint8Array): string {
  let binary = "";
  const CHUNK = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + CHUNK));
  }
  return btoa(binary);
}

function b64decode(text: string): Uint8Array<ArrayBuffer> {
  const binary = atob(text);
  const out = new Uint8Array(new ArrayBuffer(binary.length));
  for (let index = 0; index < binary.length; index += 1) {
    out[index] = binary.charCodeAt(index);
  }
  return out;
}

const keyCache = new Map<string, CryptoKey>();

/** Per-device KDF salt, created once; the salt is not secret. */
export function deviceSalt(store: StorageLike): string {
  try {
    const stored = store.getItem(SALT_KEY);
    if (typeof stored === "string" && stored !== "") {
      return stored;
    }
    const fresh = b64encode(randomBytes(16));
    store.setItem(SALT_KEY, fresh);
    return fresh;
  } catch {
    return b64encode(randomBytes(16));
  }
}

async function keyFor(uid: string, salt: string): Promise<CryptoKey> {
  const cached = keyCache.get(`${uid}:${salt}`);
  if (cached !== undefined) {
    return cached;
  }
  const subtle = cryptoRef().subtle;
  const base = await subtle.importKey(
    "raw",
    new TextEncoder().encode(uid),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  const key = await subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: b64decode(salt),
      iterations: PBKDF2_ITERATIONS,
      hash: "SHA-256",
    },
    base,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
  keyCache.set(`${uid}:${salt}`, key);
  return key;
}

/** Open one envelope; null when the ID is wrong or bytes corrupted. */
export async function unsealText(
  uid: string,
  salt: string,
  envelope: SealedEnvelope,
): Promise<string | null> {
  try {
    const key = await keyFor(uid, salt);
    const opened = await cryptoRef().subtle.decrypt(
      { name: "AES-GCM", iv: b64decode(envelope.iv) },
      key,
      b64decode(envelope.data),
    );
    return new TextDecoder().decode(opened);
  } catch {
    return null;
  }
}

/** Fresh random KDF salt for one export bundle (carried, not secret). */
export function randomSalt(): string {
  try {
    return b64encode(randomBytes(16));
  } catch {
    return b64encode(new Uint8Array(16));
  }
}

/** Seal text under the ID with an explicit salt (export bundles). */
export async function sealWithSalt(
  uid: string,
  salt: string,
  text: string,
): Promise<SealedEnvelope> {
  const cryptoKey = await keyFor(uid, salt);
  const iv = randomBytes(12);
  const sealed = await cryptoRef().subtle.encrypt(
    { name: "AES-GCM", iv },
    cryptoKey,
    new TextEncoder().encode(text),
  );
  return {
    v: 1,
    iv: b64encode(iv),
    data: b64encode(new Uint8Array(sealed)),
  };
}

/** Seal text under the ID and store the envelope. Never throws. */
export async function sealText(
  store: StorageLike,
  key: string,
  uid: string,
  text: string,
): Promise<void> {
  try {
    const envelope = await sealWithSalt(uid, deviceSalt(store), text);
    store.setItem(key, JSON.stringify(envelope));
  } catch {
    // A blocked store keeps data in memory only — same as plaintext.
  }
}

export interface SealedRead {
  /** Plaintext, or null when missing, corrupt, or locked to another ID. */
  text: string | null;
  /** True when a plaintext value was migrated to sealed on this read. */
  migrated: boolean;
}

/**
 * Read one progress key: sealed envelopes open under the ID,
 * legacy plaintext migrates to sealed, anything else reads null.
 * Locked envelopes are never overwritten — adopting the right ID
 * recovers them. Never throws.
 */
export async function loadSealedText(
  store: StorageLike,
  key: string,
  uid: string,
): Promise<SealedRead> {
  let raw: string | null;
  try {
    raw = store.getItem(key);
  } catch {
    return { text: null, migrated: false };
  }
  if (raw === null) {
    return { text: null, migrated: false };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { text: null, migrated: false };
  }
  if (isEnvelope(parsed)) {
    const salt = deviceSalt(store);
    const text = await unsealText(uid, salt, parsed);
    return { text, migrated: false };
  }
  await sealText(store, key, uid, raw);
  return { text: raw, migrated: true };
}

/**
 * Re-seal progress keys from an old ID to an adopted one. Each key
 * is only rewritten after it opened (or was plaintext); keys that
 * won't open stay exactly as they were. Never throws.
 */
export async function resealStores(
  store: StorageLike,
  keys: readonly string[],
  oldUid: string,
  newUid: string,
): Promise<void> {
  if (oldUid === newUid) {
    return;
  }
  const salt = deviceSalt(store);
  for (const key of keys) {
    try {
      const raw = store.getItem(key);
      if (raw === null) {
        continue;
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        continue;
      }
      if (isEnvelope(parsed)) {
        const text = await unsealText(oldUid, salt, parsed);
        if (text === null) {
          continue;
        }
        await sealText(store, key, newUid, text);
      } else {
        await sealText(store, key, newUid, raw);
      }
    } catch {
      // Leave the key as-is; locked data beats lost data.
    }
  }
}
