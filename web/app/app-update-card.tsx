"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/base/buttons/button";
import {
  UPDATE_CHECK_KEY,
  checkDue,
  checkForUpdate,
  currentVersion,
  type UpdateStatus,
} from "@/lib/app-update";
import { safeGetItem, safeSetItem } from "@/lib/safe-storage";

/**
 * App updates: the running build, a manual check button, and one
 * automatic server check per week. An available update links the
 * download page; failures say so without blocking anything else.
 */
export default function AppUpdateCard(): React.ReactElement {
  const [running, setRunning] = useState<string | null>(null);
  const [lastCheck, setLastCheck] = useState<string | null>(() =>
    safeGetItem(UPDATE_CHECK_KEY),
  );
  const [status, setStatus] = useState<UpdateStatus | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    void currentVersion().then((version) => {
      if (live) {
        setRunning(version);
      }
    });
    return () => {
      live = false;
    };
  }, []);

  useEffect(() => {
    if (!checkDue(safeGetItem(UPDATE_CHECK_KEY), Date.now())) {
      return;
    }
    let live = true;
    setBusy(true);
    void checkForUpdate().then((next) => {
      if (!live) {
        return;
      }
      setBusy(false);
      setStatus(next);
      const stamped = new Date().toISOString();
      safeSetItem(UPDATE_CHECK_KEY, stamped);
      setLastCheck(stamped);
    });
    return () => {
      live = false;
    };
  }, []);

  async function checkNow(): Promise<void> {
    setBusy(true);
    const next = await checkForUpdate();
    setBusy(false);
    setStatus(next);
    const stamped = new Date().toISOString();
    safeSetItem(UPDATE_CHECK_KEY, stamped);
    setLastCheck(stamped);
  }

  return (
    <section aria-labelledby="app-update-heading">
      <h2 id="app-update-heading">App updates</h2>
      <p className="hint" role="status">
        {running === null
          ? "This build cannot report its version."
          : `Running ${running}; the app checks for updates weekly.`}
        {lastCheck !== null && lastCheck !== ""
          ? ` Last checked ${lastCheck.slice(0, 10)}.`
          : ""}
        {status?.state === "current" &&
          ` Shipped ${status.shipped.version} — you are up to date.`}
        {status?.state === "failed" && ` Last check failed: ${status.error}.`}
        {status?.state === "unknown-version" &&
          " The running version is unknown, so no comparison ran."}
      </p>
      {status?.state === "available" && (
        <p className="hint" role="status">
          Update available: {status.shipped.version} —{" "}
          <a href={status.shipped.url}>download the latest app</a>
          {status.shipped.notes !== "" ? ` (${status.shipped.notes})` : ""}.
        </p>
      )}
      <p className="cta-row">
        <Button
          variant="primary"
          size="small"
          disabled={busy}
          onClick={() => {
            void checkNow();
          }}
        >
          {busy ? "Checking…" : "Check for updates"}
        </Button>
      </p>
    </section>
  );
}
