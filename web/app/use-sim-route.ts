"use client";

import { useSyncExternalStore } from "react";
import { getSimRoute, loadLocalSim, subscribeSimRoute } from "@/lib/direct-sim";
import type { SimRoute } from "@/lib/direct-sim";

/** Live sim route plus the configured local endpoint. */
export function useSimRoute(): { route: SimRoute; endpoint: string } {
  const route = useSyncExternalStore(subscribeSimRoute, getSimRoute, getSimRoute);
  return { route, endpoint: loadLocalSim() };
}
