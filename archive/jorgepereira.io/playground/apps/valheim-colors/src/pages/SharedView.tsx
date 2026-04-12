import { useEffect, useState, useCallback } from "react";
import { useParams } from "react-router-dom";
import type { SheetData } from "../types";
import * as api from "../api";
import { GroupCard } from "../components/GroupCard";
import { Toast } from "../components/Toast";

export function SharedView() {
  const { token } = useParams<{ token: string }>();
  const [data, setData] = useState<SheetData | null>(null);
  const [userId, setUserId] = useState("");
  const [error, setError] = useState(false);
  const [toast, setToast] = useState({ message: "", visible: false });

  const showToast = useCallback((message: string) => {
    setToast({ message, visible: true });
  }, []);

  useEffect(() => {
    if (!token) return;
    api
      .getSharedSheet(token)
      .then((res) => {
        setData(res.data);
        setUserId(res.userId);
      })
      .catch(() => setError(true));
  }, [token]);

  function copyCode(code: string) {
    navigator.clipboard.writeText(code).then(() => showToast("Copied"));
  }

  if (error) {
    return (
      <div className="page">
        <p className="empty">Sheet not found or no longer shared.</p>
      </div>
    );
  }

  if (!data) {
    return <div className="page"><p className="loading">Loading...</p></div>;
  }

  return (
    <div className="page">
      <div className="page-header">
        <h1>{data.name}</h1>
      </div>
      <div className="shared-banner">Shared by {userId} &middot; Read-only</div>

      <div className="columns-grid">
        {data.columns.map((column, colIdx) => (
          <div key={colIdx} className="column">
            {column.map((group, groupIdx) => (
              <GroupCard
                key={groupIdx}
                group={group}
                editMode={false}
                onUpdateGroup={() => {}}
                onDeleteGroup={() => {}}
                onCopy={copyCode}
              />
            ))}
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
