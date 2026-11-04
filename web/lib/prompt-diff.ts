/** Word-level diff between two prompt versions, for iteration review. */

export type DiffKind = "same" | "added" | "removed";

export interface DiffSegment {
  kind: DiffKind;
  text: string;
}

function words(text: string): string[] {
  return text.split(/\s+/).filter((word) => word !== "");
}

/** Longest-common-subsequence word diff, coalesced into segments. */
export function promptDiff(before: string, after: string): DiffSegment[] {
  const a = words(before);
  const b = words(after);
  const rows = a.length;
  const cols = b.length;
  const dp: number[][] = Array.from({ length: rows + 1 }, () =>
    Array.from({ length: cols + 1 }, () => 0),
  );
  for (let i = rows - 1; i >= 0; i--) {
    for (let j = cols - 1; j >= 0; j--) {
      const row = dp[i];
      const below = dp[i + 1];
      if (row === undefined || below === undefined) continue;
      row[j] =
        a[i] === b[j]
          ? (below[j + 1] ?? 0) + 1
          : Math.max(below[j] ?? 0, row[j + 1] ?? 0);
    }
  }
  const raw: DiffSegment[] = [];
  const push = (kind: DiffKind, word: string): void => {
    const last = raw[raw.length - 1];
    if (last?.kind === kind) {
      last.text += ` ${word}`;
    } else {
      raw.push({ kind, text: word });
    }
  };
  let i = 0;
  let j = 0;
  while (i < rows && j < cols) {
    if (a[i] === b[j]) {
      push("same", a[i] ?? "");
      i++;
      j++;
    } else if ((dp[i + 1]?.[j] ?? 0) >= (dp[i]?.[j + 1] ?? 0)) {
      push("removed", a[i] ?? "");
      i++;
    } else {
      push("added", b[j] ?? "");
      j++;
    }
  }
  while (i < rows) push("removed", a[i++] ?? "");
  while (j < cols) push("added", b[j++] ?? "");
  return raw;
}

/** Change counts for a diff summary line. */
export function diffStats(segments: DiffSegment[]): { added: number; removed: number } {
  let added = 0;
  let removed = 0;
  for (const segment of segments) {
    const count = segment.text === "" ? 0 : segment.text.split(" ").length;
    if (segment.kind === "added") added += count;
    if (segment.kind === "removed") removed += count;
  }
  return { added, removed };
}
