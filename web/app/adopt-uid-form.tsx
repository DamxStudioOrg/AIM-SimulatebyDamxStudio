"use client";

import { useState } from "react";
import { Button } from "@/components/base/buttons/button";
import { useAuth } from "./auth-context";
import { isValidUid } from "@/lib/vault";

/**
 * Existing-ID login: previous users paste the arena ID they stored
 * and this device adopts it (progress re-seals onto the ID). The
 * gate passes onAdopted to finish signing in; signed-in surfaces
 * (Recovery, Account) adopt in place and confirm inline.
 */
export default function AdoptUidForm({
  idPrefix,
  onAdopted,
}: Readonly<{ idPrefix: string; onAdopted?: () => void }>): React.ReactElement {
  const auth = useAuth();
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const inputId = `${idPrefix}-arena-id`;

  async function adopt(): Promise<void> {
    const clean = draft.trim();
    if (!isValidUid(clean)) {
      setError("That doesn't look like an arena ID — check the paste.");
      return;
    }
    setBusy(true);
    setError(null);
    const ok = await auth.adoptUid(clean);
    setBusy(false);
    if (!ok) {
      setError("That ID could not be adopted on this device.");
      return;
    }
    if (onAdopted !== undefined) {
      onAdopted();
      return;
    }
    setDone(true);
  }

  return (
    <details className="adopt-id">
      <summary>Already have an arena ID?</summary>
      <label htmlFor={inputId}>Arena ID</label>
      <input
        id={inputId}
        type="text"
        autoComplete="off"
        spellCheck={false}
        value={draft}
        placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
        onChange={(event) => {
          setDraft(event.target.value);
          setError(null);
          setDone(false);
        }}
      />
      <p className="cta-row">
        <Button
          variant="primary"
          disabled={busy}
          onClick={() => {
            void adopt();
          }}
        >
          {busy ? "Signing in…" : "Sign in with this ID"}
        </Button>
      </p>
      {error !== null && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {done && (
        <p className="notice" role="status">
          Adopted — this device now uses that ID.
        </p>
      )}
    </details>
  );
}
