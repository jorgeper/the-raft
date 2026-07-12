import { useEffect, useState } from "react";
import { backend } from "./ipc";
import type {
  DownloadProgress,
  ModelInfo,
  Settings as TSettings,
  VoiceEntry,
} from "./types";

interface Props {
  settings: TSettings;
  onSettingsChange: (s: TSettings) => void;
  onRerunOobe: () => void;
  onBack: () => void;
}

function fmtSize(bytes: number): string {
  return bytes >= 1_000_000_000
    ? `${(bytes / 1_000_000_000).toFixed(1)} GB`
    : `${Math.round(bytes / 1_000_000)} MB`;
}

function Settings({ settings, onSettingsChange, onRerunOobe, onBack }: Props) {
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [voices, setVoices] = useState<VoiceEntry[]>([]);
  const [progress, setProgress] = useState<Record<string, DownloadProgress>>({});
  const [error, setError] = useState<string | null>(null);

  const refresh = () => backend.listModels().then(setModels);
  const refreshVoices = () => backend.listVoices().then(setVoices);

  useEffect(() => {
    refresh();
    refreshVoices();
  }, []);

  useEffect(() => {
    return backend.onDownloadProgress((p) => {
      setProgress((prev) => ({ ...prev, [p.model]: p }));
      if (p.error) setError(p.error);
      if (p.done) refresh();
    });
  }, []);

  async function update(next: TSettings) {
    await backend.setSettings(next);
    onSettingsChange(next);
    refresh();
  }

  return (
    <div className="settings">
      <header className="conv-header">
        <button className="btn-back" onClick={onBack} aria-label="Back to home">
          ‹
        </button>
        <h2 className="settings-title">Settings</h2>
      </header>

      <div className="settings-body">
        {error && <div className="banner-error">{error}</div>}

        <section>
          <h3 className="section-title">Transcription model</h3>
          {models
            .filter((m) => m.kind === "transcription")
            .map((m) => {
              const p = progress[m.name];
              const downloading = p && !p.done && !p.error;
              return (
                <div className="model-row" key={m.name}>
                  <input
                    type="radio"
                    name="active-model"
                    aria-label={`Use ${m.label}`}
                    checked={settings.stt_model === m.name}
                    disabled={!m.installed}
                    onChange={() => update({ ...settings, stt_model: m.name })}
                  />
                  <span className="model-label">{m.label}</span>
                  <span className="model-hint">{m.hint}</span>
                  {downloading ? (
                    <progress max={100} value={Math.round((p.downloaded / p.total) * 100)} />
                  ) : m.installed ? (
                    <button
                      className="btn-mini quiet"
                      disabled={settings.stt_model === m.name}
                      title={
                        settings.stt_model === m.name
                          ? "Switch models before deleting the active one"
                          : "Delete model file"
                      }
                      onClick={() => backend.deleteModel(m.name).then(refresh)}
                    >
                      Delete
                    </button>
                  ) : (
                    <button
                      className="btn-mini"
                      onClick={() => {
                        setError(null);
                        backend.downloadModel(m.name);
                      }}
                    >
                      Download {fmtSize(m.size_bytes)}
                    </button>
                  )}
                </div>
              );
            })}
        </section>

        <section>
          <h3 className="section-title">Speaker diarization</h3>
          {models
            .filter((m) => m.kind === "diarization")
            .map((m) => {
              const p = progress[m.name];
              const downloading = p && !p.done && !p.error;
              return (
                <div className="model-row" key={m.name}>
                  <span className="model-label">{m.label}</span>
                  <span className="model-hint">{m.hint}</span>
                  {downloading ? (
                    <progress max={100} value={Math.round((p.downloaded / p.total) * 100)} />
                  ) : m.installed ? (
                    <span className="model-size">installed</span>
                  ) : (
                    <button
                      className="btn-mini"
                      onClick={() => backend.downloadModel(m.name)}
                    >
                      Download {fmtSize(m.size_bytes)}
                    </button>
                  )}
                </div>
              );
            })}
        </section>

        <section>
          <h3 className="section-title">Remembered voices</h3>
          {voices.length === 0 && (
            <p className="model-hint">
              None yet. After a recording, click “Remember this voice” on a
              speaker to auto-name them in future meetings.
            </p>
          )}
          {voices.map((v) => (
            <div className="model-row" key={v.id}>
              <span className="model-label">{v.name}</span>
              <span className="model-hint">
                remembered {new Date(v.created_at).toLocaleDateString()}
              </span>
              <button
                className="btn-mini quiet"
                onClick={() => backend.forgetVoice(v.id).then(refreshVoices)}
              >
                Delete
              </button>
            </div>
          ))}
        </section>

        <section>
          <h3 className="section-title">Recording</h3>
          <label className="keep-audio">
            <input
              type="checkbox"
              checked={settings.keep_audio}
              onChange={(e) => update({ ...settings, keep_audio: e.target.checked })}
            />
            Keep audio inside saved conversations
          </label>
        </section>

        <section>
          <h3 className="section-title">Setup</h3>
          <button className="btn-mini" onClick={onRerunOobe}>
            Re-run first-launch setup
          </button>
        </section>
      </div>
    </div>
  );
}

export default Settings;
