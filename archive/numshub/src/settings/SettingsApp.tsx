// Settings window (SPEC FR-6): General / Hotkey / Models / Cleanup, plus the
// first-run onboarding wizard (FR-7) when onboarding is incomplete.

import { useCallback, useEffect, useState } from "react";
import { api, listen } from "../ipc/api";
import type { HistoryEntry, ModelStatus, Settings } from "../ipc/types";
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
        {section === "general" && (
          <GeneralSection
            settings={settings}
            save={save}
            history={history}
            refreshHistory={refreshHistory}
          />
        )}
        {section === "hotkey" && <HotkeySection settings={settings} save={save} />}
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
