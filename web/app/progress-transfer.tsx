"use client";

import { useState } from "react";
import { Button } from "@/components/base/buttons/button";
import { HISTORY_KEY, loadHistory, mergeHistories } from "@/lib/history";
import { loadSealedText, sealText } from "@/lib/sealed-store";
import {
  exportProgressBundle,
  getOrCreateUid,
  openProgressBundle,
  parseProgressBundle,
} from "@/lib/vault";
import { useAuth } from "./auth-context";

interface ProgressTransferProps {
  showExport?: boolean;
  onAdopted?: () => void;
}

/** Export/import progress bundles between logins. Shared by account + keys. */
export default function ProgressTransfer({
  showExport = true,
  onAdopted,
}: ProgressTransferProps): React.ReactElement {
  const auth = useAuth();
  const [notice, setNotice] = useState<string | null>(null);
  const [transfer, setTransfer] = useState("");
  const [transferOut, setTransferOut] = useState<string | null>(null);

  async function copyExport(): Promise<void> {
    if (transferOut === null) {
      return;
    }
    try {
      await navigator.clipboard.writeText(transferOut);
      setNotice("Copied — paste it on the other login.");
    } catch {
      setNotice("Copy failed — select the text and copy it manually.");
    }
  }

  return (
    <>
      <h3>Move to another login</h3>
      <p className="hint">
        Copy this device&apos;s progress, sign in on the other login, paste it below.
        Runs merge by date; provider keys stay per device and are never included. The
        bundle only opens under this login&apos;s arena ID.
      </p>
      {notice !== null && (
        <p className="notice" role="status">
          {notice}
        </p>
      )}
      {showExport && (
        <>
          <p className="cta-row key-actions">
            <Button
              variant="secondary"
              size="small"
              onClick={() => {
                void (async () => {
                  try {
                    const read = await loadSealedText(
                      window.localStorage,
                      HISTORY_KEY,
                      getOrCreateUid(),
                    );
                    const local = loadHistory(read.text);
                    setTransferOut(await exportProgressBundle(auth.uid, local));
                    setNotice(null);
                  } catch {
                    setNotice("Export failed on this device.");
                  }
                })();
              }}
            >
              Export progress
            </Button>{" "}
            <Button
              variant="ghost"
              size="small"
              disabled={transferOut === null}
              onClick={() => {
                void copyExport();
              }}
            >
              Copy
            </Button>
          </p>
          {transferOut !== null && (
            <textarea
              aria-label="Exported progress"
              readOnly
              rows={3}
              value={transferOut}
              onFocus={(event) => {
                event.target.select();
              }}
            />
          )}
        </>
      )}
      <label htmlFor="progress-import">Import progress from another login</label>
      <textarea
        id="progress-import"
        rows={3}
        value={transfer}
        placeholder="Paste exported progress here…"
        onChange={(event) => {
          setTransfer(event.target.value);
        }}
      />
      <p className="cta-row key-actions">
        <Button
          variant="primary"
          size="small"
          onClick={() => {
            void (async () => {
              const bundle = parseProgressBundle(transfer);
              if (bundle === null) {
                setNotice("That text is not valid progress — check the paste.");
                return;
              }
              if (!(await auth.adoptUid(bundle.uid))) {
                setNotice("That ID could not be adopted on this device.");
                return;
              }
              const incoming = await openProgressBundle(bundle, bundle.uid);
              if (incoming === null) {
                setNotice("Adopted the ID, but the bundle would not open under it.");
                return;
              }
              try {
                const read = await loadSealedText(
                  window.localStorage,
                  HISTORY_KEY,
                  bundle.uid,
                );
                const local = loadHistory(read.text);
                const merged = mergeHistories(local, incoming);
                await sealText(
                  window.localStorage,
                  HISTORY_KEY,
                  bundle.uid,
                  JSON.stringify(merged),
                );
              } catch {
                setNotice("Adopted the ID, but history would not save here.");
                return;
              }
              setTransfer("");
              setNotice(`Progress restored — ${String(incoming.length)} runs.`);
              onAdopted?.();
            })();
          }}
        >
          Import progress
        </Button>
      </p>
    </>
  );
}
