/**
 * Allocation diff heatmap for prompt ablation.
 * Shows per-turn per-key allocation difference between two runs.
 */

import type { MatchTurn } from "@/lib/sim";

export default function AllocationDiffHeatmap({
  turnsA,
  turnsB,
}: {
  turnsA: MatchTurn[];
  turnsB: MatchTurn[];
}) {
  const keys = [
    "housing",
    "transit",
    "health",
    "green",
    "reserves",
    "rescue",
    "shelter",
    "repair",
  ];
  const maxTurns = Math.max(turnsA.length, turnsB.length);

  const getAlloc = (turn: MatchTurn | undefined) => {
    const alloc = turn?.allocation ?? {};
    const obj: Record<string, number> = {};
    for (const k of keys) obj[k] = alloc[k] ?? 0;
    return obj;
  };

  const cellStyle = (delta: number) => {
    const intensity = Math.min(1, Math.abs(delta) / 25);
    const hue = delta >= 0 ? 120 : 0; // green/red
    return { background: `hsl(${String(hue)}, 70%, ${String(70 - intensity * 40)}%)` };
  };

  return (
    <div className="allocation-diff">
      <h4>Allocation diff heatmap</h4>
      <p className="hint">
        Positive = A allocated more than B. Color intensity = magnitude.
      </p>
      <table>
        <thead>
          <tr>
            <th>Turn</th>
            {keys.map((k) => (
              <th key={k}>{k}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: maxTurns }, (_, i) => {
            const a = getAlloc(turnsA[i]);
            const b = getAlloc(turnsB[i]);
            return (
              <tr key={i}>
                <td>{i + 1}</td>
                {keys.map((k) => {
                  const delta = (a[k] ?? 0) - (b[k] ?? 0);
                  return (
                    <td key={k} style={cellStyle(delta)}>
                      {delta > 0 ? `+${delta.toFixed(1)}` : delta.toFixed(1)}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
