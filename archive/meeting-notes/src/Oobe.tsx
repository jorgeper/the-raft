import { useEffect, useState } from "react";
import { backend } from "./ipc";
import type { DownloadProgress, ModelInfo, Settings } from "./types";

interface Props {
  settings: Settings;
  onDone: (settings: Settings) => void;
}

type Step = "welcome" | "mic" | "model" | "download" | "done";

function fmtSize(bytes: number): string {
  return bytes >= 1_000_000_000
    ? `${(bytes / 1_000_000_000).toFixed(1)} GB`
    : `${Math.round(bytes / 1_000_000)} MB`;
}

function Oobe({ settings, onDone }: Props) {
  const [step, setStep] = useState<Step>("welcome");
  const [micState, setMicState] = useState<"unknown" | "granted" | "denied">("unknown");
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [choice, setChoice] = useState(settings.stt_model || "small");
  const [progress, setProgress] = useState<Record<string, DownloadProgress>>({});
  const [downloadError, setDownloadError] = useState<string | null>(null);

  useEffect(() => {
    backend.listModels().then(setModels);
  }, []);

  useEffect(() => {
    return backend.onDownloadProgress((p) => {
      setProgress((prev) => ({ ...prev, [p.model]: p }));
      if (p.error) setDownloadError(p.error);
    });
  }, []);

  const transcription = models.filter((m) => m.kind === "transcription");
  const needed = [choice, "embedding"].filter(
    (name) => !models.find((m) => m.name === name)?.installed,
  );
  const allDone =
    needed.length === 0 || needed.every((name) => progress[name]?.done);

  async function startDownloads() {
    setDownloadError(null);
    setStep("download");
    for (const name of needed) {
      await backend.downloadModel(name);
    }
  }

  async function finish() {
    const next = { ...settings, stt_model: choice, oobe_done: true };
    await backend.setSettings(next);
    onDone(next);
  }

  return (
    <div className="oobe">
      <div className="oobe-card">
        {step === "welcome" && (
          <>
            <h1 className="wordmark">Minutes</h1>
            <p className="oobe-lead">
              Meeting notes, transcribed and speaker-labeled entirely on this
              computer. No accounts, no cloud — your audio never leaves this
              device.
            </p>
            <button className="btn-primary" onClick={() => setStep("mic")}>
              Set up
            </button>
          </>
        )}

        {step === "mic" && (
          <>
            <h2 className="oobe-title">Microphone</h2>
            <p className="oobe-lead">
              Minutes listens to the room while you record. macOS will ask for
              permission once.
            </p>
            {micState === "denied" && (
              <p className="oobe-warn">
                Microphone unavailable. Grant access in System Settings →
                Privacy &amp; Security → Microphone, then continue.
              </p>
            )}
            <button
              className="btn-primary"
              onClick={async () => {
                const ok = await backend.requestMicPermission();
                setMicState(ok ? "granted" : "denied");
                if (ok) setStep("model");
              }}
            >
              Enable microphone
            </button>
            <button className="btn-quiet" onClick={() => setStep("model")}>
              Skip for now
            </button>
          </>
        )}

        {step === "model" && (
          <>
            <h2 className="oobe-title">Choose a transcription model</h2>
            <p className="oobe-lead">
              Downloaded once, then everything runs offline. You can switch
              models later in Settings.
            </p>
            <div className="model-list" role="radiogroup">
              {transcription.map((m) => (
                <label
                  key={m.name}
                  className={`model-row ${choice === m.name ? "chosen" : ""}`}
                >
                  <input
                    type="radio"
                    name="model"
                    checked={choice === m.name}
                    onChange={() => setChoice(m.name)}
                  />
                  <span className="model-label">{m.label}</span>
                  <span className="model-hint">{m.hint}</span>
                  <span className="model-size">
                    {m.installed ? "installed" : fmtSize(m.size_bytes)}
                  </span>
                </label>
              ))}
            </div>
            <button
              className="btn-primary"
              onClick={() => (needed.length ? startDownloads() : setStep("done"))}
            >
              {needed.length ? "Download and continue" : "Continue"}
            </button>
          </>
        )}

        {step === "download" && (
          <>
            <h2 className="oobe-title">Downloading</h2>
            <p className="oobe-lead">
              This is the only time Minutes uses the network — verify it with
              your firewall if you like. Every future session is fully offline.
            </p>
            {needed.map((name) => {
              const m = models.find((x) => x.name === name);
              const p = progress[name];
              const pct = p ? Math.round((p.downloaded / p.total) * 100) : 0;
              return (
                <div className="dl-row" key={name}>
                  <span className="model-label">{m?.label ?? name}</span>
                  <progress max={100} value={p?.done ? 100 : pct} />
                  <span className="model-size">{p?.done ? "done" : `${pct}%`}</span>
                </div>
              );
            })}
            {downloadError && <p className="oobe-warn">{downloadError}</p>}
            {allDone && !downloadError && (
              <button className="btn-primary" onClick={() => setStep("done")}>
                Continue
              </button>
            )}
          </>
        )}

        {step === "done" && (
          <>
            <h2 className="oobe-title">You're set</h2>
            <p className="oobe-lead">
              From here on, Minutes is fully offline. Start a conversation and
              just talk — say “I am {"<your name>"}” at any point and your words
              get labeled automatically.
            </p>
            <button className="btn-primary" onClick={finish}>
              Start using Minutes
            </button>
          </>
        )}
      </div>
      <footer className="local-badge">
        <span className="dot-local" aria-hidden="true" />
        100% local — no audio ever leaves this device.
      </footer>
    </div>
  );
}

export default Oobe;
