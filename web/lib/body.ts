/**
 * Shared JSON-body validators for API routes. Every route narrows an
 * unknown body through these helpers instead of hand-rolling casts.
 */

/** The body as a string-keyed record, or null when it is not an object. */
export function recordOf(body: unknown): Record<string, unknown> | null {
  if (typeof body !== "object" || body === null || Array.isArray(body)) return null;
  return body as Record<string, unknown>;
}

/** A required non-blank string field within `max` chars, else null. */
export function stringField(
  record: Record<string, unknown>,
  key: string,
  max: number,
): string | null {
  const value = record[key];
  if (typeof value !== "string" || value.trim() === "" || value.length > max) {
    return null;
  }
  return value;
}

/** An integer field within [min, max], else null. */
export function intField(
  record: Record<string, unknown>,
  key: string,
  min: number,
  max: number,
): number | null {
  const value = record[key];
  if (typeof value !== "number" || !Number.isInteger(value)) return null;
  return value >= min && value <= max ? value : null;
}

/** A finite number field, else null. */
export function numberField(
  record: Record<string, unknown>,
  key: string,
): number | null {
  const value = record[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** An allocation-shaped field: string keys to finite numbers, else null. */
export function allocationField(
  record: Record<string, unknown>,
  key: string,
): Record<string, number> | null {
  const value = record[key];
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  const entries = Object.entries(value);
  if (!entries.every(([, v]) => typeof v === "number" && Number.isFinite(v))) {
    return null;
  }
  return value as Record<string, number>;
}
