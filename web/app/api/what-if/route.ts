import type { WhatIfResult } from "@/lib/sim";
import { runWhatIf } from "@/lib/sim";
import { createProxy, simErrorMap } from "@/lib/api-proxy";
import { allocationField, intField, recordOf } from "@/lib/body";

interface WhatIfRequest {
  seed: number;
  allocations: (Record<string, number> | null)[];
  turn: number;
  allocation: Record<string, number>;
}

const TOTAL_TURNS = 12;

function isValidWhatIfRequest(body: unknown): body is WhatIfRequest {
  const record = recordOf(body);
  if (record === null) return false;
  const turn = intField(record, "turn", 1, TOTAL_TURNS);
  const allocation = allocationField(record, "allocation");
  const allocations = record.allocations;
  return (
    typeof record.seed === "number" &&
    Array.isArray(allocations) &&
    allocations.length === TOTAL_TURNS &&
    allocations.every(
      (entry) => entry === null || allocationField({ entry }, "entry") !== null,
    ) &&
    turn !== null &&
    allocation !== null
  );
}

export const POST = createProxy<WhatIfRequest, WhatIfResult>({
  handler: async (input) =>
    runWhatIf(input.seed, input.allocations, input.turn, input.allocation),
  validate: isValidWhatIfRequest,
  errorMap: simErrorMap,
});
