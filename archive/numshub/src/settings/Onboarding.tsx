// First-run wizard (SPEC FR-7): welcome -> microphone -> accessibility (macOS)
// -> model choice with download progress -> try it. Re-runnable from General.

import { useEffect, useMemo, useState } from "react";
import { api, isTauri, listen } from "../ipc/api";
import type { DownloadProgress, ModelStatus, Settings } from "../ipc/types";

type StepId = "welcome" | "microphone" | "accessibility" | "model" | "try";

export default function Onboarding({
  settings,
  models,
  refreshModels,
  onDone,
}: {
  settings: Settings;
  models: ModelStatus[];
  refreshModels: () => void;
  onDone: (settings: Settings) => Promise<void>;
}) {
  const [platform, setPlatform] = useState("macos");
  useEffect(() => {
    api.getAppInfo().then((info) => setPlatform(info.platform)).catch(() => {});
  }, []);

  const steps = useMemo<StepId[]>(
    () =>
      platform === "macos"
        ? ["welcome", "microphone", "accessibility", "model", "try"]
        : ["welcome", "microphone", "model", "try"],
    [platform],
  );
  const [stepIndex, setStepIndex] = useState(0);
  const step = steps[Math.min(stepIndex, steps.length - 1)];
  const next = () => setStepIndex((i) => Math.min(i + 1, steps.length - 1));

  return (
    <div className="onboarding" data-testid="onboarding" data-step={step}>
      <div className="steps">
        {steps.map((s, i) => (
          <span key={s} className={`step-dot ${i <= stepIndex ? "done" : ""}`} />
        ))}
      </div>
      {step === "welcome" && <Welcome onNext={next} />}
      {step === "microphone" && <Microphone onNext={next} />}
      {step === "accessibility" && <Accessibility onNext={next} />}
      {step === "model" && (
        <ModelChoice models={models} refreshModels={refreshModels} onNext={next} />
      )}
      {step === "try" && <TryIt settings={settings} onDone={onDone} />}
    </div>
  );
}

function Welcome({ onNext }: { onNext: () => void }) {
  return (
    <>
      <h1>Welcome to Numshub</h1>
      <p>
        Press a hotkey anywhere, talk, press it again — clean text lands right where your cursor
        is. Everything runs on this machine: your voice never leaves it.
      </p>
      <button className="btn primary" data-testid="onboarding-next" onClick={onNext}>
        Set up Numshub
      </button>
    </>
  );
}

function Microphone({ onNext }: { onNext: () => void }) {
  const [status, setStatus] = useState<"unknown" | "granted" | "denied">("unknown");

  const request = async () => {
    if (!isTauri()) {
      setStatus("granted");
      return;
    }
    try {
      const perms = await import("tauri-plugin-macos-permissions-api");
      const granted = await perms.checkMicrophonePermission();
      if (!granted) {
        await perms.requestMicrophonePermission();
        setStatus((await perms.checkMicrophonePermission()) ? "granted" : "denied");
      } else {
        setStatus("granted");
      }
    } catch {
      // Non-mac or plugin unavailable: the first recording triggers the OS prompt.
      setStatus("granted");
    }
  };

  return (
    <>
      <h1>Microphone</h1>
      <p>Numshub needs your microphone to hear you. Audio is processed locally and discarded.</p>
      {status !== "granted" ? (
        <button className="btn primary" data-testid="mic-request" onClick={request}>
          Allow microphone access
        </button>
      ) : (
        <button className="btn primary" data-testid="onboarding-next" onClick={onNext}>
          Continue
        </button>
      )}
      {status === "denied" && (
        <p>
          Microphone access is off. Enable it in System Settings → Privacy &amp; Security →
          Microphone, then continue.
        </p>
      )}
    </>
  );
}

function Accessibility({ onNext }: { onNext: () => void }) {
  const [granted, setGranted] = useState(false);

  useEffect(() => {
    if (!isTauri()) return;
    const poll = setInterval(async () => {
      try {
        const perms = await import("tauri-plugin-macos-permissions-api");
        const ok = await perms.checkAccessibilityPermission();
        setGranted(ok);
        if (ok) {
          clearInterval(poll);
          await api.initializeCapture();
        }
      } catch {
        clearInterval(poll);
      }
    }, 1000);
    return () => clearInterval(poll);
  }, []);

  const request = async () => {
    if (!isTauri()) {
      setGranted(true);
      return;
    }
    try {
      const perms = await import("tauri-plugin-macos-permissions-api");
      await perms.requestAccessibilityPermission();
    } catch (e) {
      console.error(e);
    }
  };

  return (
    <>
      <h1>Accessibility</h1>
      <p>
        macOS requires the Accessibility permission for two things Numshub does: watching for your
        hotkey system-wide, and pressing ⌘V to paste the finished text. Numshub never reads your
        screen.
      </p>
      {!granted ? (
        <>
          <button className="btn primary" data-testid="ax-request" onClick={request}>
            Open System Settings
          </button>
          <button className="btn" data-testid="ax-skip" onClick={onNext}>
            Skip — copy to clipboard instead of pasting
          </button>
        </>
      ) : (
        <button className="btn primary" data-testid="onboarding-next" onClick={onNext}>
          Continue
        </button>
      )}
    </>
  );
}

function ModelChoice({
  models,
  refreshModels,
  onNext,
}: {
  models: ModelStatus[];
  refreshModels: () => void;
  onNext: () => void;
}) {
  const recommended = models.find((m) => m.recommended);
  const quickStart = models.find((m) => m.id === "whisper-tiny");
  const [progress, setProgress] = useState<DownloadProgress | null>(null);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    (async () => {
      unlisten = await listen<DownloadProgress>("model-download-progress", setProgress);
    })();
    return () => unlisten?.();
  }, []);

  const ready = models.some((m) => m.downloaded);

  const download = async (m: ModelStatus) => {
    setDownloadingId(m.id);
    setError(null);
    try {
      await api.downloadModel(m.id);
      await api.setActiveModel(m.id);
      refreshModels();
      onNext();
    } catch (e) {
      setError(String(e));
      setDownloadingId(null);
    }
  };

  const pick = async (m: ModelStatus) => {
    if (m.downloaded) {
      await api.setActiveModel(m.id);
      refreshModels();
      onNext();
    } else {
      await download(m);
    }
  };

  return (
    <>
      <h1>Pick a model</h1>
      <p>This is the only download Numshub ever makes. You can add or switch models later.</p>
      {downloadingId ? (
        <div style={{ width: 320 }}>
          <div className="progress-track">
            <div
              className="progress-fill"
              style={{ width: `${progress?.percentage ?? 0}%` }}
              data-testid="onboarding-progress"
            />
          </div>
          <p style={{ marginTop: 8 }}>{Math.round(progress?.percentage ?? 0)}%</p>
        </div>
      ) : (
        <div style={{ display: "flex", gap: 10 }}>
          {recommended && (
            <button className="btn primary" data-testid="pick-recommended" onClick={() => pick(recommended)}>
              {recommended.display_name} — recommended
            </button>
          )}
          {quickStart && (
            <button className="btn" data-testid="pick-quickstart" onClick={() => pick(quickStart)}>
              {quickStart.display_name} — quick start (75 MB)
            </button>
          )}
        </div>
      )}
      {error && <p className="download-error">{error}</p>}
      {ready && !downloadingId && (
        <button className="btn" data-testid="onboarding-next" onClick={onNext}>
          Continue with what's installed
        </button>
      )}
    </>
  );
}

function TryIt({
  settings,
  onDone,
}: {
  settings: Settings;
  onDone: (settings: Settings) => Promise<void>;
}) {
  return (
    <>
      <h1>Try it here</h1>
      <p>
        Click into the box below, press your hotkey, and say something. When the pill disappears,
        your words appear at the cursor.
      </p>
      <textarea
        placeholder="Dictate into me…"
        data-testid="try-box"
        style={{ maxWidth: 420 }}
        onFocus={() => api.initializeCapture().catch(() => {})}
      />
      <button
        className="btn primary"
        data-testid="onboarding-finish"
        onClick={() => onDone(settings)}
      >
        Finish setup
      </button>
    </>
  );
}
