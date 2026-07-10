// Cleanup (SPEC FR-6.4): filler chips editor, repeated-word toggle, and the
// localhost-only enhancement settings with a Test round-trip.

import { useState } from "react";
import { api } from "../ipc/api";
import type { Settings } from "../ipc/types";
import { DEFAULT_ENHANCEMENT } from "../ipc/types";
import { addFiller, removeFiller, resetFillers } from "../lib/fillers";
import { Toggle } from "./SettingsApp";

export default function CleanupSection({
  settings,
  save,
}: {
  settings: Settings;
  save: (s: Settings) => Promise<void>;
}) {
  const [newWord, setNewWord] = useState("");
  const [testResult, setTestResult] = useState<{ ok: boolean; text: string } | null>(null);
  const [testing, setTesting] = useState(false);
  const [endpointError, setEndpointError] = useState<string | null>(null);

  const submitWord = () => {
    const next = addFiller(settings.filler_words, newWord);
    if (next !== settings.filler_words) {
      save({ ...settings, filler_words: next });
    }
    setNewWord("");
  };

  const runTest = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const text = await api.testEnhancement("");
      setTestResult({ ok: true, text });
    } catch (e) {
      setTestResult({ ok: false, text: String(e) });
    } finally {
      setTesting(false);
    }
  };

  const updateEnhancement = async (partial: Partial<Settings["enhancement"]>) => {
    setEndpointError(null);
    try {
      await save({ ...settings, enhancement: { ...settings.enhancement, ...partial } });
    } catch (e) {
      setEndpointError(String(e));
    }
  };

  return (
    <>
      <div className="section-title">Filler words</div>
      <div className="card">
        <div className="chips" data-testid="filler-chips">
          {settings.filler_words.map((word) => (
            <span className="chip" key={word} data-testid={`chip-${word}`}>
              {word}
              <button
                aria-label={`Remove ${word}`}
                data-testid={`remove-${word}`}
                onClick={() => save({ ...settings, filler_words: removeFiller(settings.filler_words, word) })}
              >
                ✕
              </button>
            </span>
          ))}
        </div>
        <div className="row">
          <input
            type="text"
            placeholder="Add a word to strip…"
            data-testid="filler-input"
            value={newWord}
            onChange={(e) => setNewWord(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submitWord()}
          />
          <div style={{ display: "flex", gap: 6 }}>
            <button className="btn" data-testid="filler-add" onClick={submitWord}>
              Add
            </button>
            <button
              className="btn"
              data-testid="filler-reset"
              onClick={() => save({ ...settings, filler_words: resetFillers() })}
            >
              Reset to defaults
            </button>
          </div>
        </div>
        <div className="row">
          <div>
            <div className="row-label">Collapse repeated words</div>
            <div className="row-sub">"the the store" becomes "the store".</div>
          </div>
          <Toggle
            checked={settings.collapse_repeats}
            testId="collapse-repeats"
            onChange={(v) => save({ ...settings, collapse_repeats: v })}
          />
        </div>
      </div>

      <div className="section-title">AI enhancement</div>
      <div className="card">
        <div className="row">
          <div>
            <div className="row-label">Enhance with a local model</div>
            <div className="row-sub">
              Rewrites each transcript through a model running on this machine (Ollama). If it
              takes longer than 5 seconds, the plain cleaned text is used instead.
            </div>
          </div>
          <Toggle
            checked={settings.enhancement.enabled}
            testId="enhancement-toggle"
            onChange={(v) => updateEnhancement({ enabled: v })}
          />
        </div>
        {settings.enhancement.enabled && (
          <>
            <div className="row">
              <div className="row-label">Endpoint</div>
              <input
                type="text"
                data-testid="enhancement-endpoint"
                defaultValue={settings.enhancement.endpoint}
                onBlur={(e) => updateEnhancement({ endpoint: e.target.value })}
              />
            </div>
            <div className="row">
              <div className="row-label">Model</div>
              <input
                type="text"
                data-testid="enhancement-model"
                defaultValue={settings.enhancement.model}
                onBlur={(e) => updateEnhancement({ model: e.target.value })}
              />
            </div>
            <div className="row" style={{ flexDirection: "column", alignItems: "stretch" }}>
              <div className="row-label" style={{ marginBottom: 6 }}>
                Prompt
              </div>
              <textarea
                data-testid="enhancement-prompt"
                defaultValue={settings.enhancement.prompt}
                onBlur={(e) => updateEnhancement({ prompt: e.target.value })}
              />
              <div style={{ display: "flex", gap: 6, marginTop: 8, justifyContent: "flex-end" }}>
                <button
                  className="btn"
                  data-testid="enhancement-prompt-reset"
                  onClick={() => updateEnhancement({ prompt: DEFAULT_ENHANCEMENT.prompt })}
                >
                  Reset prompt
                </button>
                <button
                  className="btn primary"
                  data-testid="enhancement-test"
                  disabled={testing}
                  onClick={runTest}
                >
                  {testing ? "Testing…" : "Test"}
                </button>
              </div>
            </div>
            {endpointError && (
              <div className="test-result error" data-testid="endpoint-error">
                {endpointError}
              </div>
            )}
            {testResult && (
              <div
                className={`test-result ${testResult.ok ? "" : "error"}`}
                data-testid="enhancement-test-result"
              >
                {testResult.ok ? testResult.text : `Test failed: ${testResult.text}`}
              </div>
            )}
          </>
        )}
      </div>
    </>
  );
}
