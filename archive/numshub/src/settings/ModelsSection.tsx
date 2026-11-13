// Models (SPEC FR-6.3 + §3): renders the registry with the explicit state
// machine — not downloaded -> downloading (progress + cancel) -> verifying ->
// downloaded -> active — plus failure (inline error + Retry) and delete.

import { useEffect, useState } from "react";
import { api, listen } from "../ipc/api";
import type { DownloadProgress, ModelStatus, Settings } from "../ipc/types";

function formatBytes(bytes: number): string {
  if (bytes >= 1_000_000_000) return `${(bytes / 1_000_000_000).toFixed(1)} GB`;
  return `${Math.round(bytes / 1_000_000)} MB`;
}

interface RowState {
  progress: number | null;
  verifying: boolean;
  error: string | null;
}

export default function ModelsSection({
  settings,
  models,
  refreshModels,
}: {
  settings: Settings;
  models: ModelStatus[];
  refreshModels: () => void;
}) {
  const [rows, setRows] = useState<Record<string, RowState>>({});

  const patch = (id: string, partial: Partial<RowState>) =>
    setRows((prev) => {
      const base: RowState = prev[id] ?? { progress: null, verifying: false, error: null };
      return { ...prev, [id]: { ...base, ...partial } };
    });

  useEffect(() => {
    const unlisteners: Array<() => void> = [];
    (async () => {
      unlisteners.push(
        await listen<DownloadProgress>("model-download-progress", (p) =>
          patch(p.model_id, { progress: p.percentage, error: null }),
        ),
        await listen<string>("model-verification-started", (id) =>
          patch(id, { verifying: true }),
        ),
        await listen<string>("model-verification-completed", (id) =>
          patch(id, { verifying: false }),
        ),
        await listen<string>("model-download-complete", (id) => {
          patch(id, { progress: null, verifying: false });
          refreshModels();
        }),
        await listen<string>("model-download-cancelled", (id) => {
          patch(id, { progress: null, verifying: false });
          refreshModels();
        }),
        await listen<{ model_id: string; error: string }>("model-download-failed", (p) => {
          patch(p.model_id, { progress: null, verifying: false, error: p.error });
          refreshModels();
        }),
      );
    })();
    return () => unlisteners.forEach((u) => u());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const download = (id: string) => {
    patch(id, { progress: 0, error: null });
    api.downloadModel(id).catch((e) => patch(id, { progress: null, error: String(e) }));
    refreshModels();
  };

  const totalOnDisk = models
    .filter((m) => m.downloaded)
    .reduce((sum, m) => sum + m.size_bytes, 0);

  return (
    <>
      <div className="section-title">Speech-to-text models</div>
      <div className="card" data-testid="model-list">
        {models.map((m) => {
          const row = rows[m.id] ?? { progress: null, verifying: false, error: null };
          const downloading = row.progress !== null && !row.verifying;
          return (
            <div className="model-row row" key={m.id} data-testid={`model-${m.id}`}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="model-head">
                  <label style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                    <input
                      type="radio"
                      name="active-model"
                      data-testid={`model-radio-${m.id}`}
                      checked={m.active}
                      disabled={!m.downloaded}
                      onChange={async () => {
                        await api.setActiveModel(m.id);
                        refreshModels();
                      }}
                    />
                    <span className="model-name">{m.display_name}</span>
                  </label>
                  {m.recommended && <span className="badge">Recommended</span>}
                  {m.active && (
                    <span className="badge active-badge" data-testid={`model-active-${m.id}`}>
                      Active
                    </span>
                  )}
                </div>
                <div className="row-sub">{m.description}</div>
                <div className="model-meta">
                  {formatBytes(m.size_bytes)} · {m.languages} · {m.engine}
                </div>
                {downloading && (
                  <>
                    <div className="progress-track">
                      <div
                        className="progress-fill"
                        data-testid={`progress-${m.id}`}
                        style={{ width: `${row.progress}%` }}
                      />
                    </div>
                    <div className="model-meta" data-testid={`progress-label-${m.id}`}>
                      {Math.round(row.progress!)}%
                    </div>
                  </>
                )}
                {row.verifying && (
                  <div className="model-meta" data-testid={`verifying-${m.id}`}>
                    Verifying checksum…
                  </div>
                )}
                {row.error && (
                  <div className="download-error" data-testid={`error-${m.id}`}>
                    {row.error}
                  </div>
                )}
              </div>
              <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                {!m.downloaded && !downloading && !row.verifying && (
                  <button
                    className="btn primary"
                    data-testid={`download-${m.id}`}
                    onClick={() => download(m.id)}
                  >
                    {row.error ? "Retry" : "Download"}
                  </button>
                )}
                {downloading && (
                  <button
                    className="btn"
                    data-testid={`cancel-${m.id}`}
                    onClick={async () => {
                      await api.cancelDownload(m.id);
                      patch(m.id, { progress: null });
                      refreshModels();
                    }}
                  >
                    Cancel
                  </button>
                )}
                {m.downloaded && (
                  <button
                    className="btn danger"
                    data-testid={`delete-${m.id}`}
                    onClick={async () => {
                      await api.deleteModel(m.id);
                      refreshModels();
                    }}
                  >
                    Delete
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
      <div className="section-title">Disk</div>
      <div className="card">
        <div className="row">
          <div className="row-label">Models on disk</div>
          <span className="model-meta" data-testid="disk-usage">
            {formatBytes(totalOnDisk)}
          </span>
        </div>
      </div>
      <p className="row-sub" style={{ marginTop: 10 }}>
        Models download once over HTTPS with checksum verification — after that, Numshub never
        touches the network. Active model: {settings.active_model ?? "none"}.
      </p>
    </>
  );
}
