import { useEffect, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import type { Sheet, SheetData } from "../types";
import * as api from "../api";
import { Toast } from "../components/Toast";
import defaultSheetData from "../../default-sheet.json";

export function SheetsList() {
  const navigate = useNavigate();
  const [sheets, setSheets] = useState<Sheet[]>([]);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState({ message: "", visible: false });
  const [deleting, setDeleting] = useState<string | null>(null);

  const showToast = useCallback((message: string) => {
    setToast({ message, visible: true });
  }, []);

  async function load() {
    try {
      const data = await api.listSheets();
      if (data.length === 0) {
        // First visit — create default sheet
        const result = await api.createSheet(defaultSheetData as SheetData);
        const created = await api.getSheet(result.id);
        setSheets([created]);
      } else {
        setSheets(data);
      }
    } catch {
      /* ignore */
    }
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  async function handleCreate() {
    const data: SheetData = { name: "Untitled Sheet", columns: [[]] };
    const result = await api.createSheet(data);
    navigate(`/sheets/${result.id}`);
  }

  async function handleDuplicate(e: React.MouseEvent, sheet: Sheet) {
    e.stopPropagation();
    const copy: SheetData = {
      ...sheet.data,
      name: sheet.data.name + " (copy)",
    };
    const result = await api.createSheet(copy);
    const created = await api.getSheet(result.id);
    setSheets((prev) => [created, ...prev]);
    showToast("Sheet duplicated");
  }

  async function handleShare(e: React.MouseEvent, sheet: Sheet) {
    e.stopPropagation();
    const { token } = await api.shareSheet(sheet.id);
    const url = `${window.location.origin}/valheim-colors/shared/${token}`;
    await navigator.clipboard.writeText(url);
    setSheets((prev) =>
      prev.map((s) => (s.id === sheet.id ? { ...s, shareToken: token } : s))
    );
    showToast("Share link copied");
  }

  async function confirmDelete() {
    if (!deleting) return;
    await api.deleteSheet(deleting);
    setSheets((prev) => prev.filter((s) => s.id !== deleting));
    setDeleting(null);
    showToast("Sheet deleted");
  }

  function groupCount(sheet: Sheet): number {
    return sheet.data.columns.reduce((n, col) => n + col.length, 0);
  }

  function formatDate(iso: string): string {
    return new Date(iso).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  }

  if (loading) return <div className="page"><p className="loading">Loading...</p></div>;

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1>Valheim Colors</h1>
        </div>
        <div className="actions">
          <a href="/" className="btn btn-ghost btn-sm">Home</a>
          <button className="btn btn-accent" onClick={handleCreate}>
            + New Sheet
          </button>
        </div>
      </div>

      {sheets.length === 0 ? (
        <p className="empty">No sheets yet. Create one to get started.</p>
      ) : (
        <div className="sheets-grid">
          {sheets.map((sheet) => (
            <div
              key={sheet.id}
              className="sheet-card"
              onClick={() => navigate(`/sheets/${sheet.id}`)}
            >
              <h3>{sheet.data.name}</h3>
              <div className="meta">
                {groupCount(sheet)} groups &middot; Updated{" "}
                {formatDate(sheet.updatedAt)}
              </div>
              <div className="card-actions">
                <button
                  className="btn btn-sm btn-ghost"
                  onClick={(e) => handleDuplicate(e, sheet)}
                >
                  Duplicate
                </button>
                <button
                  className="btn btn-sm btn-ghost"
                  onClick={(e) => handleShare(e, sheet)}
                >
                  Share
                </button>
                <button
                  className="btn btn-sm btn-ghost btn-danger"
                  onClick={(e) => {
                    e.stopPropagation();
                    setDeleting(sheet.id);
                  }}
                >
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {deleting && (
        <div className="overlay" onClick={() => setDeleting(null)}>
          <div className="dialog" onClick={(e) => e.stopPropagation()}>
            <h3>Delete sheet?</h3>
            <p>This action cannot be undone.</p>
            <div className="dialog-actions">
              <button className="btn" onClick={() => setDeleting(null)}>
                Cancel
              </button>
              <button className="btn btn-danger" onClick={confirmDelete}>
                Delete
              </button>
            </div>
          </div>
        </div>
      )}

      <Toast
        message={toast.message}
        visible={toast.visible}
        onHide={() => setToast((t) => ({ ...t, visible: false }))}
      />
    </div>
  );
}
