"use client";

import { useState } from "react";
import { Button } from "@/components/base/buttons/button";
import { useSimRoute } from "./use-sim-route";
import { fetchSimCall, probeLocalSim, saveLocalSim } from "@/lib/direct-sim";

/** Local sim endpoint: configure, probe, and watch the failover route. */
export default function LocalSimCard(): React.ReactElement {
  const { route, endpoint } = useSimRoute();
  const [draft, setDraft] = useState(endpoint);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function test(): Promise<void> {
    setBusy(true);
    setNotice(null);
    setError(null);
    const probe = await probeLocalSim(draft.trim() === "" ? endpoint : draft);
    setBusy(false);
    if (probe.ok) {
      setNotice(probe.detail);
    } else {
      setError(probe.detail);
    }
  }

  async function retryHosted(): Promise<void> {
    setBusy(true);
    setNotice(null);
    setError(null);
    try {
      const response = await fetchSimCall(
        { path: "/api/contract" },
        { path: "/contract" },
      );
      if (response.ok) {
        setNotice(
          route === "direct"
            ? "Hosted route is back — calls go through this site's server again."
            : "Hosted route is healthy.",
        );
      } else {
        setError(
          `Hosted route answered status ${String(response.status)} — staying local.`,
        );
      }
    } catch {
      setError("Hosted route unreachable — staying local.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-labelledby="local-sim-heading">
      <h2 id="local-sim-heading">Local sim</h2>
      <p className="hint" role="status">
        {route === "direct"
          ? `Local mode — sim calls go straight to ${endpoint}.`
          : "Hosted route — sim calls go through this site's server."}
      </p>
      <p className="hint">
        When the hosted route dies mid-session, the console fails over to your own sim
        automatically. Keep the default unless your sim runs elsewhere.
      </p>
      {notice !== null && (
        <p className="notice" role="status">
          {notice}
        </p>
      )}
      {error !== null && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <label htmlFor="local-sim-endpoint">Local sim endpoint</label>
      <input
        id="local-sim-endpoint"
        type="url"
        inputMode="url"
        value={draft}
        placeholder="http://localhost:8000"
        onChange={(event) => {
          setDraft(event.target.value);
        }}
      />
      <p className="cta-row">
        <Button
          variant="primary"
          size="small"
          disabled={busy}
          onClick={() => {
            if (saveLocalSim(draft)) {
              setNotice(`Local sim endpoint saved.`);
              setError(null);
            } else {
              setError("Enter an http(s) URL, e.g. http://localhost:8000.");
              setNotice(null);
            }
          }}
        >
          Save endpoint
        </Button>{" "}
        <Button
          variant="ghost"
          size="small"
          disabled={busy}
          onClick={() => {
            void test();
          }}
        >
          {busy ? "Testing…" : "Test"}
        </Button>{" "}
        {route === "direct" && (
          <Button
            variant="ghost"
            size="small"
            disabled={busy}
            onClick={() => {
              void retryHosted();
            }}
          >
            Retry hosted
          </Button>
        )}
      </p>
    </section>
  );
}
