"use client";

import { useEffect, useState } from "react";

type Status =
  { kind: "checking" } | { kind: "live" } | { kind: "down"; hint: string | null };

const FALLBACK_HINT =
  "Start it with `cd sim && ../.venv/bin/uvicorn aim_sim.api:create_app --factory --port 8000`, then reload.";

function readHint(body: unknown): string | null {
  if (typeof body !== "object" || body === null) {
    return null;
  }
  const hint = (body as Record<string, unknown>).hint;
  return typeof hint === "string" ? hint : null;
}

export default function SimStatus(): React.ReactElement | null {
  const [status, setStatus] = useState<Status>({ kind: "checking" });

  useEffect(() => {
    fetch("/api/contract")
      .then(async (response) => {
        const body: unknown = await response.json();
        if (!response.ok) {
          setStatus({ kind: "down", hint: readHint(body) });
          return;
        }
        setStatus({ kind: "live" });
      })
      .catch(() => {
        setStatus({ kind: "down", hint: null });
      });
  }, []);

  if (status.kind === "checking") {
    return (
      <p className="status" role="status">
        <span className="dot idle" aria-hidden="true" />
        Checking sim API…
      </p>
    );
  }

  if (status.kind === "down") {
    return (
      <p className="status" role="alert">
        <span className="dot down" aria-hidden="true" />
        Sim API is unreachable. {status.hint ?? FALLBACK_HINT}
      </p>
    );
  }

  // Healthy is silent: the nav speaks only while checking or down.
  return null;
}
