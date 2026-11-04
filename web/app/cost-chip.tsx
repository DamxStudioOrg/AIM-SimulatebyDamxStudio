import { estimateCostUsd } from "@/lib/pricing";

/** Inline run-cost suffix: exact zero for local, estimate for known hosted. */
export default function CostChip({
  tokens,
  model,
}: {
  tokens: number;
  model: string;
}): React.ReactElement | null {
  const cost = estimateCostUsd(tokens, model);
  if (cost === null) {
    return null;
  }
  if (cost === 0) {
    return <> · free (local)</>;
  }
  const shown = cost < 0.01 ? cost.toFixed(4) : cost.toFixed(2);
  return <> · ≈ ${shown} (est.)</>;
}
