"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/base/buttons/button";

export default function CopyButton({
  text,
}: Readonly<{ text: string }>): React.ReactElement {
  const [copied, setCopied] = useState(false);
  const timer = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (timer.current !== null) {
        window.clearTimeout(timer.current);
      }
    };
  }, []);

  async function copy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      timer.current = window.setTimeout(() => {
        setCopied(false);
      }, 1600);
    } catch {
      setCopied(false);
    }
  }

  return (
    <Button
      variant="ghost"
      size="small"
      onClick={() => {
        void copy();
      }}
    >
      {copied ? "Copied" : "Copy"}
    </Button>
  );
}
