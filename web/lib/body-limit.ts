/**
 * Inbound JSON body caps for the write proxies. The header check sheds
 * declared giants before parsing; the parsed check catches chunked
 * bodies that arrive without a length.
 */

/** 64 KiB: prompts, plans, and proposals fit with room to spare. */
export const MAX_JSON_BODY_BYTES = 65536;

export function bodyTooLarge(headers: Headers): boolean {
  const declared = headers.get("content-length");
  if (declared === null) {
    return false;
  }
  const length = Number.parseInt(declared, 10);
  if (!Number.isInteger(length)) {
    return false;
  }
  return length > MAX_JSON_BODY_BYTES;
}

export function jsonTooLarge(body: unknown): boolean {
  return JSON.stringify(body).length > MAX_JSON_BODY_BYTES;
}
