import { loadHistory } from "./history";
import type { HistoryEntry } from "./history";
import {
  isSealedEnvelope,
  randomSalt,
  sealWithSalt,
  unsealText,
  type SealedEnvelope,
} from "./sealed-store";

/**
 * Device vault: per-user provider keys, encrypted at rest on this device.
 *
 * Each user gets a random arena ID (used for ranking and processing) and
 * keeps their own provider keys. Keys are AES-GCM encrypted with a
 * device key held as a non-extractable handle in IndexedDB; only the
 * ciphertext sits in localStorage. Nothing key-shaped is ever persisted
 * in the clear, sent anywhere except the sim over the local link, or
 * logged.
 *
 * Honest limits: same-origin script can use the key while the page is
 * open (unavoidable for any in-browser use). What this stops is casual
 * at-rest inspection: reading localStorage, another origin, or a copied
 * profile yields ciphertext only. The sim holds a submitted key in
 * process memory for one match and never writes it anywhere.
 */

const UID_KEY = "aim-arena-uid";
const RECORD_KEY = "aim-arena-keys";
const DB_NAME = "aim-arena-vault";
const DB_STORE = "vault";
const DEK_ENTRY = "dek";
const MAX_KEY_CHARS = 2000;

interface KeyRecord {
  iv: string;
  data: string;
}

type KeyTable = Record<string, KeyRecord>;

export function isValidUid(raw: unknown): raw is string {
  return (
    typeof raw === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(raw)
  );
}

function randomUid(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
  return (
    `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-` +
    `${((parseInt(hex.slice(16, 18), 16) & 0x3f) | 0x80).toString(16)}${hex.slice(18, 20)}-` +
    hex.slice(20, 32)
  );
}

/** Adopt an arena ID from another device. False when the id is malformed. */
export function restoreUid(uid: string): boolean {
  if (!isValidUid(uid)) {
    return false;
  }
  try {
    window.localStorage.setItem(UID_KEY, uid);
    return true;
  } catch {
    return false;
  }
}

/** Stable random arena ID for this device; minimal data, nothing personal. */
export function getOrCreateUid(): string {
  try {
    const stored = window.localStorage.getItem(UID_KEY);
    if (isValidUid(stored)) {
      return stored;
    }
    const fresh = randomUid();
    window.localStorage.setItem(UID_KEY, fresh);
    return fresh;
  } catch {
    return randomUid();
  }
}

export function b64encode(bytes: Uint8Array): string {
  let binary = "";
  const CHUNK = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + CHUNK));
  }
  return btoa(binary);
}

export function b64decode(text: string): Uint8Array<ArrayBuffer> {
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(text) || text.length % 4 !== 0) {
    throw new Error("malformed base64");
  }
  const binary = atob(text);
  const out = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    out[index] = binary.charCodeAt(index);
  }
  return out;
}

export interface ProgressBundleV1 {
  version: 1;
  uid: string;
  exportedAt: string;
  history: HistoryEntry[];
}

export interface ProgressBundleV2 {
  version: 2;
  uid: string;
  exportedAt: string;
  salt: string;
  sealed: SealedEnvelope;
}

export type ParsedProgress = ProgressBundleV1 | ProgressBundleV2;

/**
 * Portable progress: arena ID plus match history as copy-paste text,
 * sealed under the ID so a pasted bundle is useless without it.
 * Provider keys are never included — each device keeps its own vault,
 * so keys are re-entered once per device. Returns "" for a bad id.
 */
export async function exportProgressBundle(
  uid: string,
  history: HistoryEntry[],
): Promise<string> {
  if (!isValidUid(uid)) {
    return "";
  }
  const salt = randomSalt();
  const bundle: ProgressBundleV2 = {
    version: 2,
    uid,
    exportedAt: new Date().toISOString(),
    salt,
    sealed: await sealWithSalt(uid, salt, JSON.stringify(history)),
  };
  return b64encode(new TextEncoder().encode(JSON.stringify(bundle)));
}

/**
 * Parse a progress bundle without opening it; null when malformed
 * or versioned wrong. v1 (legacy plaintext) still parses so old
 * exports keep working; v2 needs `openProgressBundle` with the ID.
 */
export function parseProgressBundle(raw: string): ParsedProgress | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(b64decode(raw.trim())));
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) {
    return null;
  }
  const candidate = parsed as Record<string, unknown>;
  if (!isValidUid(candidate.uid)) {
    return null;
  }
  const exportedAt =
    typeof candidate.exportedAt === "string" ? candidate.exportedAt : "";
  if (candidate.version === 1) {
    return {
      version: 1,
      uid: candidate.uid,
      exportedAt,
      history: loadHistory(JSON.stringify(candidate.history ?? [])),
    };
  }
  if (
    candidate.version === 2 &&
    typeof candidate.salt === "string" &&
    isSealedEnvelope(candidate.sealed)
  ) {
    return {
      version: 2,
      uid: candidate.uid,
      exportedAt,
      salt: candidate.salt,
      sealed: candidate.sealed,
    };
  }
  return null;
}

/**
 * Open a parsed bundle's history under the arena ID. v1 history is
 * already plaintext; v2 unseals (null when the ID is wrong, which
 * is exactly the lose-the-ID lose-the-progress rule).
 */
export async function openProgressBundle(
  bundle: ParsedProgress,
  uid: string,
): Promise<HistoryEntry[] | null> {
  if (bundle.version === 1) {
    return bundle.history;
  }
  const text = await unsealText(uid, bundle.salt, bundle.sealed);
  if (text === null) {
    return null;
  }
  return loadHistory(text);
}

/** Provider id owning one token for all its models. Meta is first. */
export const META_PROVIDER_ID = "meta";

/**
 * Vault key for a model id: provider-level for `meta/*` (one Meta API
 * token unlocks every Meta model), per-model for everything else.
 */
export function tokenKeyForModel(modelId: string): string {
  if (modelId.startsWith(`${META_PROVIDER_ID}/`)) {
    return META_PROVIDER_ID;
  }
  return modelId;
}

/** Trimmed key, or null when empty or implausibly long. */
export function normalizeProviderKey(raw: string): string | null {
  const trimmed = raw.trim();
  if (trimmed === "" || trimmed.length > MAX_KEY_CHARS) {
    return null;
  }
  return trimmed;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = window.indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(DB_STORE);
    };
    request.onsuccess = () => {
      resolve(request.result);
    };
    request.onerror = () => {
      reject(request.error ?? new Error("indexeddb unavailable"));
    };
  });
}

function idbGet(db: IDBDatabase, key: string): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DB_STORE, "readonly");
    const request = tx.objectStore(DB_STORE).get(key);
    request.onsuccess = () => {
      resolve(request.result);
    };
    request.onerror = () => {
      reject(request.error ?? new Error("indexeddb read failed"));
    };
  });
}

function idbPut(db: IDBDatabase, key: string, value: unknown): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DB_STORE, "readwrite");
    tx.objectStore(DB_STORE).put(value, key);
    tx.oncomplete = () => {
      resolve();
    };
    tx.onerror = () => {
      reject(tx.error ?? new Error("indexeddb write failed"));
    };
  });
}

/**
 * Device encryption key. Generated once, stored non-extractable: script
 * can use it for encrypt/decrypt but can never read it out.
 */
async function deviceKey(): Promise<CryptoKey> {
  const db = openDb();
  try {
    const stored = await idbGet(await db, DEK_ENTRY);
    if (stored instanceof CryptoKey) {
      return stored;
    }
    const fresh = await window.crypto.subtle.generateKey(
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt", "decrypt"],
    );
    await idbPut(await db, DEK_ENTRY, fresh);
    return fresh;
  } finally {
    (await db).close();
  }
}

function readTable(): KeyTable {
  try {
    const raw = window.localStorage.getItem(RECORD_KEY);
    if (raw === null) {
      return {};
    }
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) {
      return {};
    }
    const table: KeyTable = {};
    for (const [provider, entry] of Object.entries(parsed)) {
      const candidate = entry as Record<string, unknown> | null;
      if (
        typeof candidate === "object" &&
        candidate !== null &&
        typeof candidate.iv === "string" &&
        typeof candidate.data === "string"
      ) {
        table[provider] = { iv: candidate.iv, data: candidate.data };
      }
    }
    return table;
  } catch {
    return {};
  }
}

/** Encrypt and store one provider key on this device. Plaintext never lands. */
export async function storeProviderKey(
  provider: string,
  secret: string,
): Promise<void> {
  const key = await deviceKey();
  const iv = new Uint8Array(12);
  window.crypto.getRandomValues(iv);
  const sealed = await window.crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    new TextEncoder().encode(secret),
  );
  const table = readTable();
  table[provider] = { iv: b64encode(iv), data: b64encode(new Uint8Array(sealed)) };
  window.localStorage.setItem(RECORD_KEY, JSON.stringify(table));
}

/** Decrypt one provider key for immediate use. Returns null when absent. */
export async function loadProviderKey(provider: string): Promise<string | null> {
  const entry = readTable()[provider];
  if (entry === undefined) {
    return null;
  }
  try {
    const key = await deviceKey();
    const opened = await window.crypto.subtle.decrypt(
      { name: "AES-GCM", iv: b64decode(entry.iv) },
      key,
      b64decode(entry.data),
    );
    return new TextDecoder().decode(opened);
  } catch {
    return null;
  }
}

/** True when this device holds a key entry for the provider. */
export function hasProviderKey(provider: string): boolean {
  return readTable()[provider] !== undefined;
}

/** Drop one provider key from this device entirely. */
export function forgetProviderKey(provider: string): void {
  const rest: KeyTable = {};
  for (const [name, entry] of Object.entries(readTable())) {
    if (name !== provider) {
      rest[name] = entry;
    }
  }
  try {
    window.localStorage.setItem(RECORD_KEY, JSON.stringify(rest));
  } catch {
    // A blocked store leaves nothing readable behind anyway.
  }
}
