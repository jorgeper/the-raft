// General (SPEC FR-6.1): startup, activation mode, output, input device,
// history retention + the recent-transcriptions list (E5).

import { useEffect, useState } from "react";
import { api } from "../ipc/api";
import type { HistoryEntry, Settings } from "../ipc/types";
import { Toggle } from "./SettingsApp";

export default function GeneralSection({
  settings,
  save,
  history,
  refreshHistory,
}: {
  settings: Settings;
  save: (s: Settings) => Promise<void>;
  history: HistoryEntry[];
  refreshHistory: () => void;
}) {
  const [devices, setDevices] = useState<string[]>([]);
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);

  useEffect(() => {
    api.listInputDevices().then(setDevices).catch(console.error);
  }, []);

  const copyEntry = async (text: string, index: number) => {
    await api.copyText(text);
    setCopiedIndex(index);
    setTimeout(() => setCopiedIndex(null), 1200);
  };

  return (
    <>
      <div className="section-title">Behavior</div>
      <div className="card">
        <div className="row">
          <div>
            <div className="row-label">Launch at login</div>
            <div className="row-sub">Numshub starts with your Mac and waits in the menu bar.</div>
          </div>
          <Toggle
            checked={settings.launch_at_login}
            testId="launch-at-login"
            onChange={(v) => save({ ...settings, launch_at_login: v })}
          />
        </div>
        <div className="row">
          <div>
            <div className="row-label">Activation</div>
            <div className="row-sub">
              Toggle: press once to start, again to stop. Hold: record while the key is held.
            </div>
          </div>
          <select
            data-testid="activation-mode"
            value={settings.activation_mode}
            onChange={(e) =>
              save({ ...settings, activation_mode: e.target.value as Settings["activation_mode"] })
            }
          >
            <option value="toggle">Toggle</option>
            <option value="hold">Hold to talk</option>
          </select>
        </div>
        <div className="row">
          <div>
            <div className="row-label">Live transcription</div>
            <div className="row-sub">
              Show your words in the overlay as you speak. The pasted text is always the final,
              cleaned transcription.
            </div>
          </div>
          <Toggle
            checked={settings.live_transcription}
            testId="live-transcription"
            onChange={(v) => save({ ...settings, live_transcription: v })}
          />
        </div>
        <div className="row">
          <div>
            <div className="row-label">Output</div>
            <div className="row-sub">Where the finished transcription goes.</div>
          </div>
          <select
            data-testid="output-method"
            value={settings.output_method}
            onChange={(e) =>
              save({ ...settings, output_method: e.target.value as Settings["output_method"] })
            }
          >
            <option value="paste">Paste at cursor</option>
            <option value="clipboard_only">Clipboard only</option>
          </select>
        </div>
        <div className="row">
          <div>
            <div className="row-label">Microphone</div>
          </div>
          <select
            data-testid="input-device"
            value={settings.input_device ?? ""}
            onChange={(e) =>
              save({ ...settings, input_device: e.target.value || null })
            }
          >
            <option value="">System default</option>
            {devices.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="section-title">History</div>
      <div className="card">
        <div className="row">
          <div>
            <div className="row-label">Keep history</div>
            <div className="row-sub">
              Stores your last 20 transcriptions and the most recent recording (for Retry). Off
              keeps everything in memory only.
            </div>
          </div>
          <Toggle
            checked={settings.keep_history}
            testId="keep-history"
            onChange={(v) => save({ ...settings, keep_history: v })}
          />
        </div>
        <div className="row">
          <div>
            <div className="row-label">Re-run setup</div>
            <div className="row-sub">
              If something stopped working (permissions, hotkey, models), this re-checks
              everything and walks you through fixing whatever fails.
            </div>
          </div>
          <button
            className="btn"
            data-testid="rerun-setup"
            onClick={() =>
              save({ ...settings, onboarding_complete: false, onboarding_skips: [] })
            }
          >
            Re-run
          </button>
        </div>
        <div className="row">
          <div className="row-label">Clear history</div>
          <button
            className="btn danger"
            data-testid="clear-history"
            onClick={async () => {
              await api.clearHistory();
              refreshHistory();
            }}
          >
            Clear
          </button>
        </div>
      </div>

      <div className="section-title">Recent transcriptions</div>
      <div className="card" data-testid="history-list">
        {history.length === 0 ? (
          <div className="empty-note">
            Nothing yet — press your hotkey anywhere and start talking.
          </div>
        ) : (
          history.map((entry, i) => (
            <div
              key={`${entry.timestamp}-${i}`}
              className="row history-item"
              data-testid="history-item"
              title="Click to copy"
              onClick={() => copyEntry(entry.text, i)}
            >
              <span className="history-text">{entry.text}</span>
              <span className="history-time">
                {copiedIndex === i ? "Copied" : new Date(entry.timestamp).toLocaleTimeString()}
              </span>
            </div>
          ))
        )}
      </div>
    </>
  );
}
