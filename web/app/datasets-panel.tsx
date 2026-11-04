"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/base/buttons/button";
import type { ChallengeAssets } from "@/lib/asset-schema";
import { summarizeAssets } from "@/lib/asset-schema";
import { draftAssets } from "@/lib/community";
import {
  buildAssetPrompt,
  datasetBridge,
  formatBytes,
  type DatasetBridge,
  type DatasetManifest,
} from "@/lib/datasets";
import { safeGetItem, safeRemoveItem, safeSetItem } from "@/lib/safe-storage";

const LAST_DATASET_KEY = "aim-dataset-id";

/**
 * Dataset sandbox, desktop shell only: pick a folder with the native
 * picker, browse its sandboxed copy — the source directory stays
 * read-only — then prompt with the files to draft stage dressing on
 * the user's own model call. The desktop shell copies into a
 * workspace; every run reads the copy, never the source.
 *
 * Gated on the preload bridge: without it the section renders
 * nothing at all (no hint, no disabled controls). Folder picking
 * without the shell can't guarantee the sandbox, so plain web
 * doesn't get a degraded half-version.
 */
export default function DatasetsPanel({
  uid,
}: Readonly<{ uid: string }>): React.ReactElement | null {
  const [bridge, setBridge] = useState<DatasetBridge | null | undefined>(undefined);
  const [manifest, setManifest] = useState<DatasetManifest | null>(null);
  const [selected, setSelected] = useState<readonly string[]>([]);
  const [brief, setBrief] = useState("");
  const [model, setModel] = useState("");
  const [dressing, setDressing] = useState<ChallengeAssets | null>(null);
  const [tokens, setTokens] = useState(0);
  const [busy, setBusy] = useState(false);
  const [drafting, setDrafting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    const host = datasetBridge();
    setBridge(host);
    if (host === null) {
      return;
    }
    const last = safeGetItem(LAST_DATASET_KEY);
    if (last === null || last === "") {
      return;
    }
    host
      .get(last)
      .then((restored) => {
        setManifest(restored);
        setSelected(restored.files.map((file) => file.rel));
      })
      .catch(() => {
        safeRemoveItem(LAST_DATASET_KEY);
      });
  }, []);

  // The gate: unresolved or bridgeless renders nothing.
  if (bridge === undefined || bridge === null) {
    return null;
  }
  const host: DatasetBridge = bridge;

  function showManifest(imported: DatasetManifest): void {
    safeSetItem(LAST_DATASET_KEY, imported.id);
    setManifest(imported);
    setSelected(imported.files.map((file) => file.rel));
    setDressing(null);
    setNotice(`Sandboxed ${String(imported.summary.count)} files — source untouched.`);
  }

  async function pick(): Promise<void> {
    if (busy) {
      return;
    }
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const source = await host.pick();
      if (source === null) {
        return;
      }
      showManifest(await host.import());
    } catch (thrown) {
      setError(thrown instanceof Error ? thrown.message : "Import failed.");
    } finally {
      setBusy(false);
    }
  }

  async function removeImport(): Promise<void> {
    if (manifest === null || busy) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await host.remove(manifest.id);
      safeRemoveItem(LAST_DATASET_KEY);
      setManifest(null);
      setSelected([]);
      setDressing(null);
      setNotice("Sandbox copy deleted; the source folder was never written.");
    } catch (thrown) {
      setError(thrown instanceof Error ? thrown.message : "Delete failed.");
    } finally {
      setBusy(false);
    }
  }

  function toggle(rel: string): void {
    setSelected((previous) =>
      previous.includes(rel)
        ? previous.filter((kept) => kept !== rel)
        : [...previous, rel],
    );
  }

  async function draft(): Promise<void> {
    if (manifest === null || drafting) {
      return;
    }
    if (brief.trim() === "") {
      setError("Write a brief first — the model dresses what you describe.");
      return;
    }
    setDrafting(true);
    setError(null);
    setNotice(null);
    const result = await draftAssets({
      prompt: buildAssetPrompt(brief, manifest.files, selected),
      model: model.trim(),
      uid,
    });
    setDrafting(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setDressing(result.value.params);
    setTokens(result.value.tokens_used);
    setNotice(
      `Dressing drafted on your own call (${String(result.value.tokens_used)} tokens).`,
    );
  }

  return (
    <section className="datasets" aria-labelledby="datasets-heading">
      <h2 id="datasets-heading">Dataset sandbox</h2>
      <p className="hint">
        Pick a folder to sandbox a copy. Sources stay read-only; every run reads the
        copy.
      </p>
      <div className="panel-actions">
        <Button
          variant="primary"
          size="small"
          onClick={() => {
            void pick();
          }}
          disabled={busy}
        >
          {busy ? "Working…" : "Select dataset folder"}
        </Button>
        {manifest !== null && (
          <Button
            variant="ghost"
            size="small"
            onClick={() => {
              void removeImport();
            }}
            disabled={busy}
          >
            Delete sandbox copy
          </Button>
        )}
      </div>
      {error !== null && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {notice !== null && <p className="hint">{notice}</p>}
      {manifest !== null && (
        <>
          <dl className="dataset-meta">
            <div>
              <dt>Source (read-only)</dt>
              <dd>{manifest.source}</dd>
            </div>
            <div>
              <dt>Sandbox</dt>
              <dd>
                {String(manifest.summary.count)} files ·{" "}
                {formatBytes(manifest.summary.bytes)}
              </dd>
            </div>
          </dl>
          <ul className="dataset-files">
            {manifest.files.map((file) => (
              <li key={file.rel}>
                <label>
                  <input
                    type="checkbox"
                    checked={selected.includes(file.rel)}
                    onChange={() => {
                      toggle(file.rel);
                    }}
                  />
                  <span>{file.rel}</span>
                  <span className="chip">{file.kind}</span>
                  <span className="muted">{formatBytes(file.size)}</span>
                </label>
              </li>
            ))}
          </ul>
          <div className="dataset-prompt">
            <label htmlFor="dataset-brief">Prompt with these files</label>
            <textarea
              id="dataset-brief"
              value={brief}
              onChange={(event) => {
                setBrief(event.target.value);
              }}
              placeholder="A moonlit festival city built from my data…"
              rows={3}
            />
            <label htmlFor="dataset-model">Model (blank uses the sim default)</label>
            <input
              id="dataset-model"
              value={model}
              onChange={(event) => {
                setModel(event.target.value);
              }}
              placeholder="ollama"
              autoComplete="off"
            />
            <div className="panel-actions">
              <Button
                variant="primary"
                size="small"
                onClick={() => {
                  void draft();
                }}
                disabled={drafting || brief.trim() === ""}
              >
                {drafting ? "Drafting…" : "Draft stage dressing"}
              </Button>
            </div>
          </div>
          {dressing !== null && (
            <p className="hint">
              Drafted ({String(tokens)} tokens): {summarizeAssets(dressing)}
            </p>
          )}
        </>
      )}
    </section>
  );
}
