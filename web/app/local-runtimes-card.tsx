"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/base/buttons/button";
import { loadLocalRuntime, saveLocalRuntime } from "@/lib/local-runtimes";

interface SourceState {
  name: string;
  base: string;
  ok: boolean;
  models: string[];
  error: string | null;
}

/**
 * Local runtimes: point at LM Studio and Ollama, probe what models
 * they expose through the OpenAI `/v1/models` standard. Bases persist
 * on this device only. Match routing still follows the sim server's
 * own environment — this card answers "what runs here", not "what
 * the sim sees" (compare with the contract's model list when a model
 * is missing from a run).
 */
export default function LocalRuntimesCard(): React.ReactElement {
  const [lmstudio, setLmstudio] = useState("");
  const [ollama, setOllama] = useState("");
  const [sources, setSources] = useState<SourceState[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    setLmstudio(loadLocalRuntime("lmstudio"));
    setOllama(loadLocalRuntime("ollama"));
  }, []);

  async function probe(): Promise<void> {
    setBusy(true);
    setError(null);
    setSources(null);
    saveLocalRuntime("lmstudio", lmstudio);
    saveLocalRuntime("ollama", ollama);
    try {
      const params = new URLSearchParams();
      if (lmstudio.trim() !== "") {
        params.set("lmstudio", lmstudio.trim());
      }
      if (ollama.trim() !== "") {
        params.set("ollama", ollama.trim());
      }
      const query = params.size === 0 ? "" : `?${params.toString()}`;
      const response = await fetch(`/api/local-models${query}`);
      const body = (await response.json()) as {
        sources?: SourceState[];
        error?: string;
      };
      if (!response.ok || !Array.isArray(body.sources)) {
        setError(body.error ?? "Discovery failed.");
        return;
      }
      setSources(body.sources);
    } catch {
      setError("Discovery unreachable — reload and retry.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-labelledby="local-runtimes-heading">
      <h2 id="local-runtimes-heading">Local runtimes</h2>
      <p className="hint">
        Connect LM Studio and Ollama running on this machine. Probing lists the models
        each runtime exposes — matches themselves run through the sim server&apos;s own
        runtime addresses.
      </p>
      {error !== null && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <label htmlFor="runtime-lmstudio">LM Studio base URL</label>
      <input
        id="runtime-lmstudio"
        type="text"
        inputMode="url"
        autoComplete="off"
        spellCheck={false}
        value={lmstudio}
        onChange={(event) => {
          setLmstudio(event.target.value);
        }}
      />
      <label htmlFor="runtime-ollama">Ollama base URL</label>
      <input
        id="runtime-ollama"
        type="text"
        inputMode="url"
        autoComplete="off"
        spellCheck={false}
        value={ollama}
        onChange={(event) => {
          setOllama(event.target.value);
        }}
      />
      <p className="cta-row">
        <Button
          variant="primary"
          size="small"
          disabled={busy}
          onClick={() => {
            void probe();
          }}
        >
          {busy ? "Probing…" : "Probe runtimes"}
        </Button>
      </p>
      {sources !== null && (
        <ul className="tight">
          {sources.map((source) => (
            <li key={source.name}>
              <strong>{source.name}</strong> — {source.base}:{" "}
              {source.ok ? (
                source.models.length === 0 ? (
                  "no models loaded"
                ) : (
                  source.models.join(", ")
                )
              ) : (
                <span className="error">{source.error}</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
