"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/base/buttons/button";

/**
 * Run action with live progress: while running, a spinner plus the
 * caller's status text and a ticking elapsed-seconds readout (turn
 * counts for city matches, plain packing for the tote). The text is
 * the report — the spinner is decoration only, and it stands still
 * under reduced motion.
 */
export default function RunButton({
  running,
  startedAt,
  idleLabel,
  busyLabel,
  disabled,
  tourAnchor,
  onRun,
}: Readonly<{
  running: boolean;
  /** Epoch ms the run started; null while idle. */
  startedAt: number | null;
  idleLabel: string;
  /** Status while running, e.g. "Turn 4 of 12". */
  busyLabel: string;
  disabled: boolean;
  tourAnchor?: string;
  onRun: () => void;
}>): React.ReactElement {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!running) {
      return;
    }
    setNow(Date.now());
    const timer = window.setInterval(() => {
      setNow(Date.now());
    }, 1000);
    return () => {
      window.clearInterval(timer);
    };
  }, [running]);
  const elapsed =
    startedAt === null ? 0 : Math.max(0, Math.floor((now - startedAt) / 1000));
  const label = running ? `${busyLabel} · ${String(elapsed)}s` : idleLabel;
  return (
    <>
      <Button
        variant="primary"
        disabled={disabled || running}
        data-tour={tourAnchor}
        onClick={() => {
          onRun();
        }}
      >
        {running && <span className="run-spin" aria-hidden="true" />}
        {label}
      </Button>
      {/* Live progress for screen readers; kept out of the button so
          the button's own accessible name stays the visible label. */}
      <span className="visually-hidden" role="status">
        {running ? label : ""}
      </span>
    </>
  );
}
