"use client";

import { useEffect, useRef, useState } from "react";
import {
  REVEAL_TIMEOUT_MS,
  createTimedReveal,
  type TimedReveal,
} from "@/lib/timed-reveal";
import CopyButton from "./copy-button";
import { Button } from "@/components/base/buttons/button";

export { REVEAL_TIMEOUT_MS };

/** Click-to-reveal state that auto-hides; re-clicking re-arms the timer. */
export function useTimedReveal(timeoutMs: number = REVEAL_TIMEOUT_MS): {
  visible: boolean;
  reveal: () => void;
  hide: () => void;
} {
  const [visible, setVisible] = useState(false);
  const control = useRef<TimedReveal | null>(null);
  control.current ??= createTimedReveal(setVisible, timeoutMs);

  useEffect(
    () => () => {
      control.current?.dispose();
    },
    [],
  );

  const controlRef = control;
  return {
    visible,
    reveal: () => {
      controlRef.current?.reveal();
    },
    hide: () => {
      controlRef.current?.hide();
    },
  };
}

interface SecretRevealProps {
  value: string;
  label: string;
}

/** Masked secret with click-to-reveal, copy, and an auto-hide timeout. */
export default function SecretReveal({
  value,
  label,
}: SecretRevealProps): React.ReactElement {
  const { visible, reveal, hide } = useTimedReveal();
  if (!visible) {
    return (
      <>
        <code aria-label={`${label} hidden`}>••••••••</code>{" "}
        <Button
          variant="ghost"
          size="xs"
          title="Reveals for 15 seconds"
          onClick={reveal}
        >
          Reveal
        </Button>
      </>
    );
  }
  return (
    <>
      <code title="Hides automatically">{value === "" ? "…" : value}</code>{" "}
      {value !== "" && <CopyButton text={value} />}{" "}
      <Button variant="ghost" size="xs" onClick={hide}>
        Hide
      </Button>
    </>
  );
}
