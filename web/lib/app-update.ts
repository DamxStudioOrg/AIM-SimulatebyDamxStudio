/**
 * App updates: compare the running build against the board's shipped
 * version. The desktop shell reports its version over the preload
 * bridge; plain web falls back to the build-stamped env version.
 * Checks run on demand plus automatically when a week has passed.
 */

export const UPDATE_CHECK_KEY = "aim-update-last-check";
export const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/** Per-platform installer links from the version endpoint. */
export interface PlatformDownloads {
  mac: string;
  windows: string;
  linux: string;
}

export interface ShippedVersion {
  version: string;
  url: string;
  notes: string;
  /** Absent on older servers and when the map fails validation. */
  downloads?: PlatformDownloads;
}

export type UpdateStatus =
  | { state: "current"; shipped: ShippedVersion }
  | { state: "available"; shipped: ShippedVersion }
  | { state: "unknown-version" }
  | { state: "failed"; error: string };

type Triple = [number, number, number];

/** Strict `major.minor.patch`; anything else reads null. */
export function parseVersion(text: string): Triple | null {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(text.trim());
  if (match === null) {
    return null;
  }
  const parts = match.slice(1, 4).map((part) => Number.parseInt(part, 10));
  if (parts.some((part) => !Number.isInteger(part) || part < 0)) {
    return null;
  }
  return parts as Triple;
}

/**
 * Compare two versions: negative when `a` is older, 0 when equal,
 * positive when newer. Null when either side is unparseable.
 */
export function compareVersions(a: string, b: string): number | null {
  const left = parseVersion(a);
  const right = parseVersion(b);
  if (left === null || right === null) {
    return null;
  }
  for (let index = 0; index < 3; index += 1) {
    const diff = (left[index] ?? 0) - (right[index] ?? 0);
    if (diff !== 0) {
      return diff;
    }
  }
  return 0;
}

/** True when no check is recorded or the last one is a week old. */
export function checkDue(lastCheckIso: string | null, nowMs: number): boolean {
  if (lastCheckIso === null || lastCheckIso === "") {
    return true;
  }
  const last = Date.parse(lastCheckIso);
  if (Number.isNaN(last)) {
    return true;
  }
  return nowMs - last >= WEEK_MS;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** True for absolute http(s) URLs only — never javascript: or relative. */
export function isHttpUrl(value: unknown): value is string {
  if (typeof value !== "string" || value.trim() === "") {
    return false;
  }
  let parsed: URL;
  try {
    parsed = new URL(value.trim());
  } catch {
    return false;
  }
  return parsed.protocol === "http:" || parsed.protocol === "https:";
}

/**
 * The downloads map, or null when any platform is missing or not an
 * http(s) URL. One bad link voids the map so callers fall back to
 * the release page instead of serving a half-wired row.
 */
export function parseDownloads(value: unknown): PlatformDownloads | null {
  if (!isRecord(value)) {
    return null;
  }
  const { mac, windows, linux } = value;
  if (!isHttpUrl(mac) || !isHttpUrl(windows) || !isHttpUrl(linux)) {
    return null;
  }
  return { mac, windows, linux };
}

/** Fetch the shipped version through the local proxy. */
export async function fetchShipped(): Promise<ShippedVersion> {
  let response: Response;
  try {
    response = await fetch("/api/app-version", { cache: "no-store" });
  } catch {
    throw new Error("update server unreachable");
  }
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new Error("update server returned a bad payload");
  }
  if (!response.ok) {
    const detail =
      isRecord(body) && typeof body.error === "string"
        ? body.error
        : "update check failed";
    throw new Error(detail);
  }
  if (
    !isRecord(body) ||
    typeof body.version !== "string" ||
    !isHttpUrl(body.url) ||
    typeof body.notes !== "string"
  ) {
    throw new Error("update server returned a bad payload");
  }
  const downloads = parseDownloads(body.downloads);
  return {
    version: body.version,
    url: body.url,
    notes: body.notes,
    ...(downloads === null ? {} : { downloads }),
  };
}

/**
 * Running build version: the desktop bridge first, the stamped env
 * on plain web, null when neither answers (dev shells without the
 * bridge).
 */
export async function currentVersion(): Promise<string | null> {
  if (typeof window !== "undefined") {
    const exposed = (window as unknown as Record<string, unknown>).SimulatebyDamxStudio;
    if (isRecord(exposed) && typeof exposed.getVersion === "function") {
      try {
        const version = await (exposed.getVersion as () => Promise<unknown>)();
        if (typeof version === "string" && version.trim() !== "") {
          return version.trim();
        }
      } catch {
        // Fall through to the stamped version.
      }
    }
  }
  const stamped = process.env.NEXT_PUBLIC_APP_VERSION;
  return stamped !== undefined && stamped.trim() !== "" ? stamped.trim() : null;
}

/** One full check: fetch shipped, compare against the running build. */
export async function checkForUpdate(): Promise<UpdateStatus> {
  let shipped: ShippedVersion;
  try {
    shipped = await fetchShipped();
  } catch (error) {
    return {
      state: "failed",
      error: error instanceof Error ? error.message : "update check failed",
    };
  }
  const running = await currentVersion();
  if (running === null) {
    return { state: "unknown-version" };
  }
  const order = compareVersions(running, shipped.version);
  if (order === null) {
    return { state: "unknown-version" };
  }
  return order < 0 ? { state: "available", shipped } : { state: "current", shipped };
}
