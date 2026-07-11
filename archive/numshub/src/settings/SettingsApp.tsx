// Settings window (SPEC FR-6): General / Hotkey / Models / Cleanup, plus the
// first-run onboarding wizard (FR-7) when onboarding is incomplete.

import { useCallback, useEffect, useState } from "react";
import { api, listen } from "../ipc/api";
import type { HistoryEntry, ModelStatus, Settings } from "../ipc/types";
import type { StepId } from "../lib/onboarding";
import GeneralSection from "./GeneralSection";
import HotkeySection from "./HotkeySection";
import ModelsSection from "./ModelsSection";
import CleanupSection from "./CleanupSection";
import Onboarding from "./Onboarding";

export type SectionId = "general" | "hotkey" | "models" | "cleanup";

const SECTIONS: { id: SectionId; label: string; icon: string }[] = [
  { id: "general", label: "General", icon: "⚙︎" },
  { id: "hotkey", label: "Hotkey", icon: "⌘" },
  { id: "models", label: "Models", icon: "▣" },
  { id: "cleanup", label: "Cleanup", icon: "✦" },
];

export default function SettingsApp() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [models, setModels] = useState<ModelStatus[]>([]);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [section, setSection] = useState<SectionId>("general");
  const [captureDead, setCaptureDead] = useState(false);

  const refreshModels = useCallback(() => {
    api.listModels().then(setModels).catch(console.error);
    // active_model is backend-owned; refetch so our copy never goes stale.
    api.getSettings().then(setSettings).catch(console.error);
  }, []);

  const refreshHistory = useCallback(() => {
    api.getHistory().then(setHistory).catch(console.error);
  }, []);

  useEffect(() => {
    api.getSettings().then(setSettings).catch(console.error);
    refreshModels();
    refreshHistory();
    const unlisteners: Array<() => void> = [];
    (async () => {
      unlisteners.push(
        await listen("history-changed", refreshHistory),
        await listen("model-download-complete", refreshModels),
        await listen("model-deleted", refreshModels),
        await listen<string>("navigate-section", (s) => {
          if (SECTIONS.some((x) => x.id === s)) setSection(s as SectionId);
        }),
      );
    })();
    return () => unlisteners.forEach((u) => u());
  }, [refreshModels, refreshHistory]);

  // Capture-dead banner (SPEC4 FR-F2.1): poll while the normal sections are
  // showing; the banner clears itself when the hotkey listener recovers.
  const onboardingActive = settings ? !settings.onboarding_complete : true;
  useEffect(() => {
    if (onboardingActive) {
      setCaptureDead(false);
      return;
    }
    let cancelled = false;
    const check = async () => {
      try {
        const info = await api.getAppInfo();
        if (!cancelled) {
          setCaptureDead(info.platform === "macos" && !info.capture_ready);
        }
      } catch {
        /* window closing */
      }
    };
    check();
    const poll = setInterval(check, 2000);
    return () => {
      cancelled = true;
      clearInterval(poll);
    };
  }, [onboardingActive]);

  const save = useCallback(async (next: Settings) => {
    setSettings(next);
    try {
      await api.setSettings(next);
    } catch (e) {
      console.error("saving settings failed:", e);
      const fresh = await api.getSettings();
      setSettings(fresh);
      throw e;
    }
  }, []);

  // SPEC4 FR-F1: the single recovery entry point. Clears the completion flag
  // (and the given deferrals, so a broken-but-deferred gate is re-checked);
  // SPEC2's gate resolution then opens the wizard at the first unmet gate.
  const startSetup = useCallback(
    async (clearDeferrals: StepId[] = []) => {
      const current = await api.getSettings();
      await save({
        ...current,
        onboarding_complete: false,
        onboarding_skips: current.onboarding_skips.filter(
          (s) => !clearDeferrals.includes(s as StepId),
        ),
      });
    },
    [save],
  );

  if (!settings) return null;

  if (!settings.onboarding_complete) {
    return (
      <Onboarding
        settings={settings}
        models={models}
        refreshModels={refreshModels}
        onDone={(next) => save({ ...next, onboarding_complete: true })}
      />
    );
  }

  return (
    <div className="settings" data-testid="settings-root">
      <nav className="settings-nav">
        <div className="app-name">Numshub</div>
        {SECTIONS.map((s) => (
          <button
            key={s.id}
            className={`nav-item ${section === s.id ? "active" : ""}`}
            data-testid={`nav-${s.id}`}
            onClick={() => setSection(s.id)}
          >
            <span aria-hidden>{s.icon}</span>
            {s.label}
          </button>
        ))}
      </nav>
      <main className="settings-content" data-testid={`section-${section}`}>
        {captureDead && (
          <div className="banner" data-testid="capture-banner">
            <span>
              The dictation hotkey is inactive — Accessibility permission is missing or was
              re-keyed by an update.
            </span>
            <button
              className="btn primary"
              data-testid="capture-banner-fix"
              onClick={() => startSetup(["accessibility"])}
            >
              Fix in setup
            </button>
          </div>
        )}
        {section === "general" && (
          <GeneralSection
            settings={settings}
            save={save}
            history={history}
            refreshHistory={refreshHistory}
          />
        )}
        {section === "hotkey" && (
          <HotkeySection settings={settings} save={save} startSetup={startSetup} />
        )}
        {section === "models" && (
          <ModelsSection settings={settings} models={models} refreshModels={refreshModels} />
        )}
        {section === "cleanup" && <CleanupSection settings={settings} save={save} />}
      </main>
    </div>
  );
}

export function Toggle({
  checked,
  onChange,
  testId,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  testId?: string;
}) {
  return (
    <label className="switch">
      <input
        type="checkbox"
        checked={checked}
        data-testid={testId}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span className="knob" />
    </label>
  );
}
