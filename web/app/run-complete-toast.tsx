"use client";

import { useEffect, useMemo } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useSyncExternalStore } from "react";
import { Button } from "@/components/base/buttons/button";
import {
  COMPLETION_TOAST_MS,
  ackCompletion,
  getStoreSnapshot,
  pendingCompletions,
  subscribeStore,
} from "@/lib/match-run-store";
import { link } from "@/lib/routing";

/**
 * Background-run popup: when a simulation settles while the player
 * browses another menu, this offers one tap back to the verdict.
 * It never fires on the console itself (the verdict is on screen
 * there) and closes itself after the dwell when ignored.
 */
export default function RunCompleteToast(): React.ReactElement | null {
  const pathname = usePathname();
  const router = useRouter();
  const snapshot = useSyncExternalStore(
    subscribeStore,
    getStoreSnapshot,
    getStoreSnapshot,
  );
  const notice = useMemo(() => pendingCompletions(snapshot)[0] ?? null, [snapshot]);
  const onConsole = pathname === link("console");

  // A completion that lands under the player's eyes needs no
  // popup: ack it so it never nags on a later menu hop.
  useEffect(() => {
    if (onConsole && notice !== null) {
      ackCompletion(notice.kind, notice.seq);
    }
  }, [onConsole, notice]);

  // Off-console completions auto-close after the dwell.
  useEffect(() => {
    if (onConsole || notice === null) {
      return;
    }
    const timer = window.setTimeout(() => {
      ackCompletion(notice.kind, notice.seq);
    }, COMPLETION_TOAST_MS);
    return () => {
      window.clearTimeout(timer);
    };
  }, [onConsole, notice]);

  if (onConsole || notice === null || pathname === "/") {
    return null;
  }
  const failed = notice.status === "error";
  return (
    <div className="run-complete-toast" role={failed ? "alert" : "status"}>
      <div className="run-complete-text">
        <p className="run-complete-title">{notice.title}</p>
        <p className="run-complete-detail">{notice.detail}</p>
      </div>
      <p className="run-complete-actions">
        <Button
          variant="primary"
          size="small"
          onClick={() => {
            ackCompletion(notice.kind, notice.seq);
            router.push(link("console"));
          }}
        >
          Go to operator console
        </Button>{" "}
        <Button
          variant="ghost"
          size="small"
          aria-label="Dismiss"
          onClick={() => {
            ackCompletion(notice.kind, notice.seq);
          }}
        >
          Dismiss
        </Button>
      </p>
    </div>
  );
}
