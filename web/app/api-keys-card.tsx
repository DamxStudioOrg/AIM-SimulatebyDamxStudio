"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/base/buttons/button";
import type { ModelInfo } from "@/lib/sim";
import {
  META_PROVIDER_ID,
  forgetProviderKey,
  hasProviderKey,
  normalizeProviderKey,
  storeProviderKey,
  tokenKeyForModel,
} from "@/lib/vault";
/**
 * Per-model API keys, kept on this device only. Keys are AES-GCM
 * encrypted before they touch localStorage; the plaintext lives only
 * in the password field and in sim memory for one match.
 */
export default function ApiKeysCard({
  models,
}: Readonly<{ models: ModelInfo[] }>): React.ReactElement {
  const hosted = models.filter((model) => model.kind === "hosted");
  const metaModels = hosted.filter(
    (model) => tokenKeyForModel(model.id) === META_PROVIDER_ID,
  );
  const soloModels = hosted.filter(
    (model) => tokenKeyForModel(model.id) !== META_PROVIDER_ID,
  );
  interface TokenRow {
    key: string;
    title: string;
    label: string;
  }
  const rows: TokenRow[] = [
    ...(metaModels.length > 0
      ? [
          {
            key: META_PROVIDER_ID,
            title: "Meta API token",
            label: `One token unlocks ${metaModels
              .map((model) => model.id.slice(META_PROVIDER_ID.length + 1))
              .join(", ")} (stored encrypted on this device)`,
          },
        ]
      : []),
    ...soloModels.map((model) => ({
      key: model.id,
      title: model.id,
      label: `API key for ${model.id} (stored encrypted on this device)`,
    })),
  ];
  const [stored, setStored] = useState<Record<string, boolean>>({});
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState<string | null>(null);

  const rowKeys = rows.map((row) => row.key).join(",");

  function refresh(): void {
    const next: Record<string, boolean> = {};
    for (const row of rows) {
      next[row.key] = hasProviderKey(row.key);
    }
    setStored(next);
  }

  useEffect(() => {
    refresh();
  }, [rowKeys]);

  async function save(key: string): Promise<void> {
    const clean = normalizeProviderKey(drafts[key] ?? "");
    if (clean === null) {
      setNotice("That key is empty — paste the full key and save again.");
      return;
    }
    try {
      await storeProviderKey(key, clean);
    } catch {
      setNotice("This device refused storage — the key was not saved.");
      return;
    }
    setDrafts((previous) => ({ ...previous, [key]: "" }));
    setNotice(null);
    refresh();
  }

  function forget(key: string): void {
    forgetProviderKey(key);
    refresh();
  }

  return (
    <section aria-labelledby="api-keys-heading">
      <h2 id="api-keys-heading">Your keys</h2>
      {rows.length === 0 ? (
        <p className="hint">
          The sim lists no hosted models right now, so there is nothing to unlock. Local
          models need no key.
        </p>
      ) : (
        <ul className="key-list">
          {rows.map((row) => (
            <li key={row.key}>
              <div className="key-row">
                <strong>{row.title}</strong>
                <span className="pill">
                  {stored[row.key] === true ? "Saved" : "No key"}
                </span>
              </div>
              <label htmlFor={`key-${row.key}`}>{row.label}</label>
              <input
                id={`key-${row.key}`}
                type="password"
                autoComplete="off"
                spellCheck={false}
                value={drafts[row.key] ?? ""}
                placeholder={
                  stored[row.key] === true
                    ? "••••••••"
                    : row.key === META_PROVIDER_ID
                      ? "LLM_…"
                      : "sk-…"
                }
                onChange={(event) => {
                  const value = event.target.value;
                  setDrafts((previous) => ({ ...previous, [row.key]: value }));
                }}
              />
              <p className="cta-row key-actions">
                <Button
                  variant="primary"
                  size="small"
                  onClick={() => {
                    void save(row.key);
                  }}
                >
                  Save key
                </Button>{" "}
                <Button
                  variant="ghost"
                  size="small"
                  disabled={stored[row.key] !== true}
                  onClick={() => {
                    forget(row.key);
                  }}
                >
                  Forget
                </Button>
              </p>
            </li>
          ))}
        </ul>
      )}
      {notice !== null && (
        <p className="error" role="alert">
          {notice}
        </p>
      )}
    </section>
  );
}
