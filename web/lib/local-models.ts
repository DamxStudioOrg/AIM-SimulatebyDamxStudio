/**
 * Local-model discovery helpers: loopback guard plus the OpenAI
 * `/v1/models` probe both LM Studio and Ollama speak. The API route
 * is a thin wrapper; the rules live here so unit tests pin them.
 */

export const DEFAULT_LMSTUDIO = "http://localhost:1234/v1";
/**
 * Stock LM Studio ports in try order when no base is configured:
 * 1234 is the documented default; 1235 is where a port-shifted or
 * second instance answers — mirroring the sim's own fallback sweep
 * so discovery and the contract agree on what LM Studio serves.
 */
export const LMSTUDIO_FALLBACK_BASES = [
  "http://localhost:1234/v1",
  "http://localhost:1235/v1",
] as const;
export const DEFAULT_OLLAMA = "http://localhost:11434/v1";
export const PROBE_TIMEOUT_MS = 5000;

export interface LocalModelSource {
  name: string;
  base: string;
  ok: boolean;
  models: string[];
  error: string | null;
}

/**
 * Localhost-only guard: discovery bases reach out over the network,
 * so only loopback targets are accepted (no SSRF into the LAN).
 * Returns the normalized base or null.
 */
export function loopbackBase(raw: string): string | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return null;
  }
  // Node keeps the IPv6 brackets on hostname ("[::1]").
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (host !== "localhost" && host !== "127.0.0.1" && host !== "::1") {
    return null;
  }
  return url.toString().replace(/\/$/, "");
}

export async function probeModels(
  name: string,
  base: string,
): Promise<LocalModelSource> {
  const failed = (error: string): LocalModelSource => ({
    name,
    base,
    ok: false,
    models: [],
    error,
  });
  let response: Response;
  try {
    response = await fetch(`${base}/models`, {
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
  } catch {
    return failed("unreachable — is the runtime running?");
  }
  if (!response.ok) {
    return failed(`answered status ${String(response.status)}`);
  }
  let body: unknown;
  try {
    body = (await response.json()) as unknown;
  } catch {
    return failed("answered non-JSON");
  }
  const data = (body as { data?: unknown }).data;
  if (!Array.isArray(data)) {
    return failed("missing data[] in response");
  }
  const models = data
    .map((entry) => (entry as { id?: unknown }).id)
    .filter((id): id is string => typeof id === "string");
  return { name, base, ok: true, models, error: null };
}

/**
 * Probe LM Studio across the fallback ports until one answers:
 * the first ok source wins; if none answers, the first failure is
 * reported (its base is the one the user most likely checks).
 */
export async function probeLmStudio(
  bases: readonly string[] = LMSTUDIO_FALLBACK_BASES,
): Promise<LocalModelSource> {
  let firstFailure: LocalModelSource | null = null;
  for (const base of bases) {
    const source = await probeModels("LM Studio", base);
    if (source.ok) {
      return source;
    }
    firstFailure ??= source;
  }
  return (
    firstFailure ?? {
      name: "LM Studio",
      base: bases[0] ?? DEFAULT_LMSTUDIO,
      ok: false,
      models: [],
      error: "unreachable — is the runtime running?",
    }
  );
}
