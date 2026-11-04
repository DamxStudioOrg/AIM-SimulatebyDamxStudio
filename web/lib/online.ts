/**
 * True only when the runtime explicitly reports offline. Unknown counts as
 * online: non-browser runtimes (Node test env) leave onLine undefined, and
 * that must never read as offline.
 */
export function isOffline(): boolean {
  if (typeof navigator === "undefined") {
    return false;
  }
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-boolean-literal-compare -- onLine is typed boolean but undefined outside browsers; strict compare keeps unknown online.
  return navigator.onLine === false;
}
