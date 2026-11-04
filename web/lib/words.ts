/**
 * Whitespace word count matching the runner's prompt cap.
 *
 * Mirrors Python's `str.split()`: the same separator set, with empty runs
 * dropped. JavaScript's `\s` is close but wrong in both directions — it
 * misses \x1c-\x1f and \x85 (so pasted text counts low here and the sim
 * rejects it) and it splits on \uFEFF (which Python keeps glued).
 */
const PYTHON_WHITESPACE =
  // no-control-regex: \x1c-\x1f and \x85 are required to mirror Python str.split().
  // eslint-disable-next-line no-control-regex
  /[ \t\n\x0b\f\r\x1c-\x1f\x85\xa0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]+/;

export function countWords(text: string): number {
  return text.split(PYTHON_WHITESPACE).filter((part) => part !== "").length;
}
