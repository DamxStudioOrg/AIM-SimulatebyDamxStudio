/**
 * Researcher notes widget for runs.
 * Allows scientists to annotate hypotheses and observations per run.
 */

import { useState, useEffect } from "react";
import { Button } from "@/components/base/buttons/button";

export default function ResearcherNotes({ runId }: { runId: string }) {
  const [notes, setNotes] = useState("");
  const [savedAt, setSavedAt] = useState<string | null>(null);

  useEffect(() => {
    const saved = localStorage.getItem(`simulate.notes.${runId}`);
    if (saved) setNotes(saved);
  }, [runId]);

  useEffect(() => {
    if (!notes) return;
    const id = setTimeout(() => {
      localStorage.setItem(`simulate.notes.${runId}`, notes);
      setSavedAt(new Date().toLocaleTimeString());
    }, 500);
    return () => {
      clearTimeout(id);
    };
  }, [notes, runId]);

  const save = () => {
    localStorage.setItem(`simulate.notes.${runId}`, notes);
    setSavedAt(new Date().toLocaleTimeString());
  };

  return (
    <div className="researcher-notes">
      <h4>Researcher notes</h4>
      <textarea
        value={notes}
        onChange={(e) => {
          setNotes(e.target.value);
        }}
        placeholder="Hypothesis, observations, next experiments..."
      />
      <div className="notes-actions">
        <Button variant="secondary" size="small" onClick={save}>
          Save notes
        </Button>
        {savedAt && <span className="hint">Saved at {savedAt}</span>}
      </div>
    </div>
  );
}
