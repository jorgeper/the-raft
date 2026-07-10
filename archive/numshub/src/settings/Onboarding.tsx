// First-run wizard, SPEC2: one screen = one gate = one verified fact.
// Every permission step polls the REAL system state; Continue never enables
// from a button click. The wizard resumes at the first unmet gate.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, listen } from "../ipc/api";
import { permissions } from "../ipc/permissions";
import type { DownloadProgress, ModelStatus, Settings } from "../ipc/types";
import { firstUnmetStep, stepsFor, type GateSnapshot, type StepId } from "../lib/onboarding";

const POLL_MS = 1000;
const TRAY_POLL_MS = 1500;

async function readSnapshot(models: ModelStatus[], settings: Settings): Promise<GateSnapshot> {
  const perms = await permissions();
  const info = await api.getAppInfo();
  const [microphone, accessibility, captureReady, trayVisible] = await Promise.all([
    perms.checkMicrophone(),
    perms.checkAccessibility(),
    perms.checkCaptureReady(),
    perms.checkTrayVisible(),
  ]);
  const modelReady =
    settings.active_model != null &&
    models.some((m) => m.id === settings.active_model && m.downloaded);
  return { microphone, accessibility, captureReady, trayVisible, modelReady, platform: info.platform };
}

function StatusChip({ ok, checking, label }: { ok: boolean; checking?: boolean; label?: string }) {
  return (
    <span className={`badge ${ok ? "active-badge" : ""}`} data-testid="gate-status">
      {checking ? "Checking…" : ok ? (label ?? "Granted ✓") : "Not granted"}
    </span>
  );
}

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
  const [snapshot, setSnapshot] = useState<GateSnapshot | null>(null);
  const [step, setStep] = useState<StepId | null>(null);
  const skipsRef = useRef<string[]>([...settings.onboarding_skips]);
  const modelsRef = useRef(models);
  modelsRef.current = models;
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  const refreshSnapshot = useCallback(async () => {
    try {
      const snap = await readSnapshot(modelsRef.current, settingsRef.current);
      setSnapshot(snap);
      return snap;
    } catch (e) {
      console.error("snapshot failed:", e);
      return null;
    }
  }, []);

  // Resume at the first unmet gate (SPEC2 §3) — never a stored index.
  useEffect(() => {
    refreshSnapshot().then((snap) => {
      if (snap) setStep(firstUnmetStep(snap, skipsRef.current));
    });
  }, [refreshSnapshot]);

  // Poll while visible; auto-advance the moment the current gate is met.
  useEffect(() => {
    if (!step || step === "try") return;
    const interval = setInterval(
      async () => {
        const snap = await refreshSnapshot();
        if (!snap) return;
        const next = firstUnmetStep(snap, skipsRef.current);
        const order = stepsFor(snap.platform);
        // Only ever move FORWARD automatically (losing a permission
        // mid-wizard shouldn't yank the user backwards without warning).
        if (order.indexOf(next) > order.indexOf(step)) setStep(next);
      },
      step === "menubar" ? TRAY_POLL_MS : POLL_MS,
    );
    return () => clearInterval(interval);
  }, [step, refreshSnapshot]);

  // capture-ready event advances the accessibility gate without waiting a tick.
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    (async () => {
      unlisten = await listen("capture-ready", () => {
        refreshSnapshot();
      });
    })();
    return () => unlisten?.();
  }, [refreshSnapshot]);

  const skip = useCallback(
    async (id: StepId) => {
      if (!skipsRef.current.includes(id)) {
        skipsRef.current = [...skipsRef.current, id];
        // Persist so a relaunch honors the skip (SPEC2 §3).
        await api.setSettings({ ...settingsRef.current, onboarding_skips: skipsRef.current });
      }
      const snap = snapshot ?? (await refreshSnapshot());
      if (snap) setStep(firstUnmetStep(snap, skipsRef.current));
    },
    [snapshot, refreshSnapshot],
  );

  const advance = useCallback(async () => {
    const snap = await refreshSnapshot();
    if (snap) setStep(firstUnmetStep(snap, skipsRef.current));
  }, [refreshSnapshot]);

  const steps = useMemo(
    () => stepsFor(snapshot?.platform ?? "macos"),
    [snapshot?.platform],
  );

  if (!step || !snapshot) return null;

  return (
    <div className="onboarding" data-testid="onboarding" data-step={step}>
      <div className="steps">
        {steps.map((s) => (
          <span
            key={s}
            className={`step-dot ${steps.indexOf(s) <= steps.indexOf(step) ? "done" : ""}`}
          />
        ))}
      </div>
      {step === "welcome" && <Welcome onNext={() => setStep(steps[1])} />}
      {step === "microphone" && <Microphone snapshot={snapshot} onNext={advance} />}
      {step === "accessibility" && (
        <Accessibility snapshot={snapshot} onNext={advance} onSkip={() => skip("accessibility")} />
      )}
      {step === "menubar" && (
        <MenuBar snapshot={snapshot} onNext={advance} onSkip={() => skip("menubar")} />
      )}
      {step === "model" && (
        <ModelChoice models={models} refreshModels={refreshModels} onNext={advance} />
      )}
      {step === "try" && (
        <TryIt
          snapshot={snapshot}
          goTo={setStep}
          onDone={() => onDone({ ...settingsRef.current, onboarding_skips: skipsRef.current })}
        />
      )}
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
      <p>Setup checks each thing it needs and only moves on once it's really working.</p>
      <button className="btn primary" data-testid="onboarding-next" onClick={onNext}>
        Set up Numshub
      </button>
    </>
  );
}

function Microphone({ snapshot, onNext }: { snapshot: GateSnapshot; onNext: () => void }) {
  const [requested, setRequested] = useState(false);
  const granted = snapshot.microphone;

  const request = async () => {
    setRequested(true);
    const perms = await permissions();
    await perms.requestMicrophone();
  };

  return (
    <>
      <h1>Microphone</h1>
      <p>Numshub needs your microphone to hear you. Audio is processed locally and discarded.</p>
      <StatusChip ok={granted} />
      {!granted && (
        <button className="btn primary" data-testid="mic-request" onClick={request}>
          {requested ? "Waiting for permission…" : "Allow microphone access"}
        </button>
      )}
      {!granted && requested && (
        <p>
          If no prompt appeared, it was denied before: enable Numshub in System Settings →
          Privacy &amp; Security → Microphone. This screen updates by itself.
        </p>
      )}
      <button
        className="btn primary"
        data-testid="onboarding-next"
        disabled={!granted}
        onClick={onNext}
      >
        Continue
      </button>
    </>
  );
}

function Accessibility({
  snapshot,
  onNext,
  onSkip,
}: {
  snapshot: GateSnapshot;
  onNext: () => void;
  onSkip: () => void;
}) {
  // Two facts (SPEC2 FR-O2b): the permission AND the armed hotkey listener.
  const met = snapshot.accessibility && snapshot.captureReady;

  const request = async () => {
    const perms = await permissions();
    await perms.requestAccessibility();
  };

  return (
    <>
      <h1>Accessibility</h1>
      <p>
        macOS requires this for two things Numshub does: watching for your hotkey system-wide,
        and pressing ⌘V to paste the finished text. Numshub never reads your screen.
      </p>
      <StatusChip
        ok={met}
        checking={snapshot.accessibility && !snapshot.captureReady}
        label="Granted ✓ — hotkey armed"
      />
      {snapshot.accessibility && !snapshot.captureReady && (
        <p data-testid="arming-note">Permission granted — arming the hotkey listener…</p>
      )}
      {!met && (
        <>
          <button className="btn primary" data-testid="ax-request" onClick={request}>
            Open System Settings
          </button>
          <p data-testid="stale-hint">
            Already enabled in the list but still showing "Not granted" here? macOS ties the
            permission to each build of the app — remove Numshub from the Accessibility list
            (−), then add it back. This screen updates by itself.
          </p>
          <button className="btn" data-testid="ax-defer" onClick={onSkip}>
            Skip — copy to clipboard instead of pasting (no global hotkey)
          </button>
        </>
      )}
      <button
        className="btn primary"
        data-testid="onboarding-next"
        disabled={!met}
        onClick={onNext}
      >
        Continue
      </button>
    </>
  );
}

function MenuBar({
  snapshot,
  onNext,
  onSkip,
}: {
  snapshot: GateSnapshot;
  onNext: () => void;
  onSkip: () => void;
}) {
  const open = async () => {
    const perms = await permissions();
    await perms.openMenuBarSettings();
  };

  return (
    <>
      <h1>Menu bar</h1>
      <p>
        macOS decides which apps may show a menu-bar icon. Numshub's icon is how you reach
        settings, history, and retry — without it the app still works, but it's invisible.
      </p>
      <StatusChip ok={snapshot.trayVisible} label="Visible ✓" />
      {!snapshot.trayVisible && (
        <>
          <p>
            In System Settings, find <b>Numshub</b> under <b>Menu Bar</b> and turn on{" "}
            <b>Allow in the Menu Bar</b>. This screen updates by itself when the icon appears.
          </p>
          <button className="btn primary" data-testid="menubar-open" onClick={open}>
            Open System Settings
          </button>
          <button className="btn" data-testid="menubar-defer" onClick={onSkip}>
            I'll do this later
          </button>
        </>
      )}
      <button
        className="btn primary"
        data-testid="onboarding-next"
        disabled={!snapshot.trayVisible}
        onClick={onNext}
      >
        Continue
      </button>
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

  // The verified gate (SPEC2 FR-O2d): downloaded AND active.
  const ready = models.some((m) => m.downloaded && m.active);

  const pick = async (m: ModelStatus) => {
    setError(null);
    try {
      if (!m.downloaded) {
        setDownloadingId(m.id);
        await api.downloadModel(m.id);
      }
      await api.setActiveModel(m.id);
      refreshModels();
      setDownloadingId(null);
    } catch (e) {
      setError(String(e));
      setDownloadingId(null);
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
        !ready && (
          <div style={{ display: "flex", gap: 10 }}>
            {recommended && (
              <button
                className="btn primary"
                data-testid="pick-recommended"
                onClick={() => pick(recommended)}
              >
                {recommended.display_name} — recommended
              </button>
            )}
            {quickStart && (
              <button className="btn" data-testid="pick-quickstart" onClick={() => pick(quickStart)}>
                {quickStart.display_name} — quick start (75 MB)
              </button>
            )}
          </div>
        )
      )}
      {error && <p className="download-error">{error}</p>}
      {ready && (
        <button className="btn primary" data-testid="onboarding-next" onClick={onNext}>
          Continue
        </button>
      )}
    </>
  );
}

function TryIt({
  snapshot,
  goTo,
  onDone,
}: {
  snapshot: GateSnapshot;
  goTo: (s: StepId) => void;
  onDone: () => void;
}) {
  const rows: { label: string; ok: boolean; step: StepId }[] = [
    { label: "Microphone", ok: snapshot.microphone, step: "microphone" },
    {
      label: "Hotkey armed",
      ok: snapshot.accessibility && snapshot.captureReady,
      step: "accessibility",
    },
    ...(snapshot.platform === "macos"
      ? [{ label: "Menu-bar icon", ok: snapshot.trayVisible, step: "menubar" as StepId }]
      : []),
    { label: "Model active", ok: snapshot.modelReady, step: "model" },
  ];

  return (
    <>
      <h1>Try it here</h1>
      <div className="card" style={{ width: 340, textAlign: "left" }} data-testid="readiness">
        {rows.map((r) => (
          <div
            key={r.label}
            className={`row ${r.ok ? "" : "history-item"}`}
            data-testid={`ready-${r.step}`}
            onClick={() => !r.ok && goTo(r.step)}
            title={r.ok ? "" : "Click to fix"}
          >
            <span>{r.label}</span>
            <span className={`badge ${r.ok ? "active-badge" : ""}`}>{r.ok ? "Ready" : "Fix"}</span>
          </div>
        ))}
      </div>
      <p>Click into the box, press your hotkey, and say something.</p>
      <textarea placeholder="Dictate into me…" data-testid="try-box" style={{ maxWidth: 420 }} />
      <button className="btn primary" data-testid="onboarding-finish" onClick={onDone}>
        Finish setup
      </button>
    </>
  );
}
