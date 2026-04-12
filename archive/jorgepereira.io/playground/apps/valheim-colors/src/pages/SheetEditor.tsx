import { useEffect, useState, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import type { Sheet, SheetData, Group } from "../types";
import * as api from "../api";
import { GroupCard } from "../components/GroupCard";
import { Toast } from "../components/Toast";

export function SheetEditor() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [sheet, setSheet] = useState<Sheet | null>(null);
  const [editMode, setEditMode] = useState(false);
  const [draft, setDraft] = useState<SheetData | null>(null);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState({ message: "", visible: false });
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [editingName, setEditingName] = useState(false);
  const [nameValue, setNameValue] = useState("");

  const showToast = useCallback((message: string) => {
    setToast({ message, visible: true });
  }, []);

  useEffect(() => {
    if (!id) return;
    api.getSheet(id).then(setSheet).catch(() => navigate("/"));
  }, [id, navigate]);

  useEffect(() => {
    if (sheet) setNameValue(sheet.data.name);
  }, [sheet]);

  const data = editMode ? draft : sheet?.data;

  function enterEdit() {
    if (!sheet) return;
    setDraft(structuredClone(sheet.data));
    setEditMode(true);
  }

  function cancelEdit() {
    setDraft(null);
    setEditMode(false);
    setEditingName(false);
  }

  async function saveEdit() {
    if (!id || !draft) return;
    setSaving(true);
    await api.updateSheet(id, draft);
    setSheet((s) => (s ? { ...s, data: draft } : s));
    setEditMode(false);
    setDraft(null);
    setSaving(false);
    showToast("Saved");
  }

  function updateGroup(colIdx: number, groupIdx: number, updated: Group) {
    if (!draft) return;
    const columns = draft.columns.map((col, ci) =>
      ci === colIdx
        ? col.map((g, gi) => (gi === groupIdx ? updated : g))
        : col
    );
    setDraft({ ...draft, columns });
  }

  function deleteGroup(colIdx: number, groupIdx: number) {
    if (!draft) return;
    const columns = draft.columns.map((col, ci) =>
      ci === colIdx ? col.filter((_, gi) => gi !== groupIdx) : col
    );
    setDraft({ ...draft, columns });
  }

  function addGroup(colIdx: number) {
    if (!draft) return;
    const columns = draft.columns.map((col, ci) =>
      ci === colIdx ? [...col, { name: "New Group", colors: [] }] : col
    );
    setDraft({ ...draft, columns });
  }

  function addColumn() {
    if (!draft) return;
    setDraft({ ...draft, columns: [...draft.columns, []] });
  }

  function commitName() {
    if (!draft) return;
    const trimmed = nameValue.trim();
    if (trimmed) setDraft({ ...draft, name: trimmed });
    setEditingName(false);
  }

  async function handleShare() {
    if (!id) return;
    const { token } = await api.shareSheet(id);
    const url = `${window.location.origin}/valheim-colors/shared/${token}`;
    setShareUrl(url);
    await navigator.clipboard.writeText(url);
    showToast("Share link copied");
  }

  function copyCode(code: string) {
    navigator.clipboard.writeText(code).then(() => showToast(`Copied`));
  }

  if (!sheet || !data) {
    return <div className="page"><p className="loading">Loading...</p></div>;
  }

  return (
    <div className="page">
      <div className="page-header">
        <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
          <a className="back-link" onClick={() => navigate("/")} style={{ cursor: "pointer" }}>
            &larr;
          </a>
          {editMode && editingName ? (
            <input
              autoFocus
              value={nameValue}
              onChange={(e) => setNameValue(e.target.value)}
              onBlur={commitName}
              onKeyDown={(e) => {
                if (e.key === "Enter") commitName();
                if (e.key === "Escape") {
                  setNameValue(draft?.name ?? "");
                  setEditingName(false);
                }
              }}
              style={{
                background: "transparent",
                border: "none",
                borderBottom: "1px solid var(--border-hover)",
                color: "#fff",
                fontSize: "1.5rem",
                fontWeight: 600,
                outline: "none",
                padding: 0,
              }}
            />
          ) : (
            <h1
              style={editMode ? { cursor: "pointer" } : undefined}
              onClick={() => editMode && setEditingName(true)}
            >
              {data.name}
            </h1>
          )}
        </div>
      </div>

      <div className="toolbar">
        {editMode ? (
          <>
            <button className="btn btn-accent" onClick={saveEdit} disabled={saving}>
              {saving ? "Saving..." : "Save"}
            </button>
            <button className="btn" onClick={cancelEdit}>
              Cancel
            </button>
            <div className="spacer" />
            <button className="btn btn-sm" onClick={addColumn}>
              + Add Column
            </button>
          </>
        ) : (
          <>
            <button className="btn" onClick={enterEdit}>
              Edit
            </button>
            <button className="btn" onClick={handleShare}>
              Share
            </button>
          </>
        )}
      </div>

      {shareUrl && !editMode && (
        <div className="shared-banner">
          <div className="share-url">
            <input readOnly value={shareUrl} onFocus={(e) => e.target.select()} />
            <button
              className="btn btn-sm"
              onClick={() => {
                navigator.clipboard.writeText(shareUrl);
                showToast("Link copied");
              }}
            >
              Copy
            </button>
          </div>
        </div>
      )}

      <div className="columns-grid">
        {data.columns.map((column, colIdx) => (
          <div key={colIdx} className="column">
            {column.map((group, groupIdx) => (
              <GroupCard
                key={groupIdx}
                group={group}
                editMode={editMode}
                onUpdateGroup={(g) => updateGroup(colIdx, groupIdx, g)}
                onDeleteGroup={() => deleteGroup(colIdx, groupIdx)}
                onCopy={copyCode}
              />
            ))}
            {editMode && (
              <button className="add-group-btn" onClick={() => addGroup(colIdx)}>
                + Add Group
              </button>
            )}
          </div>
        ))}
      </div>

      <Toast
        message={toast.message}
        visible={toast.visible}
        onHide={() => setToast((t) => ({ ...t, visible: false }))}
      />
    </div>
  );
}
