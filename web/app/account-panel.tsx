"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/base/buttons/button";
import {
  BOT_NICKNAME_KEY,
  BOT_NICKNAME_MAX,
  DISPLAY_NAME_MAX,
  normalizeBotNickname,
} from "@/lib/auth";
import { useAuth } from "./auth-context";
import AdoptUidForm from "./adopt-uid-form";
import ProgressTransfer from "./progress-transfer";
import RecoveryCard from "./recovery-card";

/** Account-lite: one random arena ID, a local display name, recovery bundles. */
export default function AccountPanel(): React.ReactElement {
  const auth = useAuth();
  const [draft, setDraft] = useState("");
  const [saved, setSaved] = useState(false);
  const [botDraft, setBotDraft] = useState("");
  const [botSaved, setBotSaved] = useState(false);

  useEffect(() => {
    setDraft(auth.displayName ?? "");
  }, [auth.displayName]);

  useEffect(() => {
    try {
      setBotDraft(
        normalizeBotNickname(window.localStorage.getItem(BOT_NICKNAME_KEY) ?? "") ?? "",
      );
    } catch {
      setBotDraft("");
    }
  }, []);

  if (!auth.signedIn) {
    return (
      <>
        <p>
          Your account is one random ID — no password, no email. Create it to simulate
          and rank.
        </p>
        <p className="hint">Local prototype: sessions live on this machine only.</p>
        <p className="cta-row">
          <Button variant="primary" onClick={auth.continueAsGuest}>
            Create account
          </Button>
        </p>
        <h3>Already have an ID?</h3>
        <ProgressTransfer
          showExport={false}
          onAdopted={() => {
            auth.continueAsGuest();
          }}
        />
      </>
    );
  }

  return (
    <>
      {!auth.durable && (
        <p className="notice" role="status">
          Storage is blocked here — your session lasts until you leave, and nothing is
          saved.
        </p>
      )}
      <RecoveryCard uid={auth.uid} />
      <AdoptUidForm idPrefix="account-adopt" />
      <label htmlFor="account-name">
        Display name (only on this device, never sent anywhere)
      </label>
      <input
        id="account-name"
        type="text"
        autoComplete="off"
        maxLength={DISPLAY_NAME_MAX}
        value={draft}
        placeholder="e.g. Maya"
        onChange={(event) => {
          setDraft(event.target.value);
          setSaved(false);
        }}
      />
      <p className="cta-row">
        <Button
          variant="secondary"
          size="small"
          onClick={() => {
            auth.setDisplayName(draft);
            setSaved(true);
          }}
        >
          Save name
        </Button>
      </p>
      {saved && (
        <p className="notice" role="status">
          Saved.
        </p>
      )}
      <label htmlFor="account-bot">Bot nickname (shown publicly on leaderboards)</label>
      <input
        id="account-bot"
        type="text"
        autoComplete="off"
        maxLength={BOT_NICKNAME_MAX}
        value={botDraft}
        placeholder="e.g. Rusty"
        onChange={(event) => {
          setBotDraft(event.target.value);
          setBotSaved(false);
        }}
      />
      <p className="cta-row">
        <Button
          variant="secondary"
          size="small"
          onClick={() => {
            const clean = normalizeBotNickname(botDraft);
            try {
              if (clean === null) {
                window.localStorage.removeItem(BOT_NICKNAME_KEY);
              } else {
                window.localStorage.setItem(BOT_NICKNAME_KEY, clean);
              }
              setBotSaved(true);
            } catch {
              setBotSaved(false);
            }
          }}
        >
          Save nickname
        </Button>
      </p>
      {botSaved && (
        <p className="notice" role="status">
          Saved — new runs will carry it.
        </p>
      )}
      <ProgressTransfer />
      <p className="cta-row">
        <Button variant="ghost" size="small" onClick={auth.signOut}>
          Sign out
        </Button>
      </p>
    </>
  );
}
