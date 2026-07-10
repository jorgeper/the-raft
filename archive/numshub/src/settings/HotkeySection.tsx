// Hotkey recorder (SPEC FR-6.2): captures the next combo pressed — including
// bare modifiers like Right ⌘ — via the native listener (works where DOM key
// events can't). Esc cancels and restores the previous binding.

import { useEffect, useRef, useState } from "react";
import { api, listen } from "../ipc/api";
import type { CaptureEvent, Settings } from "../ipc/types";
import { formatHotkey } from "../lib/hotkey";

export default function HotkeySection({
  settings,
  save,
}: {
  settings: Settings;
  save: (s: Settings) => Promise<void>;
}) {
  const [capturing, setCapturing] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pendingRef = useRef<string>("");
  const capturingRef = useRef(false);
  capturingRef.current = capturing;

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    (async () => {
      unlisten = await listen<CaptureEvent>("hotkey-capture-event", (event) => {
        if (!capturingRef.current) return;
        if (event.is_key_down && event.hotkey_string) {
          pendingRef.current = event.hotkey_string;
          setPreview(event.hotkey_string);
        } else if (!event.is_key_down && pendingRef.current) {
          // Commit on first release: the combo is the maximum held set.
          commit(pendingRef.current);
        }
      });
    })();
    return () => unlisten?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!capturing) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") cancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [capturing]);

  const start = async () => {
    setError(null);
    setPreview(null);
    pendingRef.current = "";
    try {
      await api.startHotkeyCapture();
      setCapturing(true);
    } catch (e) {
      setError(String(e));
    }
  };

  const cancel = () => {
    api.stopHotkeyCapture();
    setCapturing(false);
    setPreview(null);
    pendingRef.current = "";
  };

  const commit = async (binding: string) => {
    api.stopHotkeyCapture();
    setCapturing(false);
    setPreview(null);
    pendingRef.current = "";
    try {
      await save({ ...settings, hotkey: binding });
    } catch (e) {
      setError(String(e));
    }
  };

  return (
    <>
      <div className="section-title">Dictation hotkey</div>
      <div className="card">
        <div className="row">
          <div>
            <div className="row-label">Hotkey</div>
            <div className="row-sub">
              Click, then press the key or combo you want — bare modifier keys like Right ⌘ work
              too. Esc cancels.
            </div>
          </div>
          <button
            className={`hotkey-chip ${capturing ? "recording-keys" : ""}`}
            data-testid="hotkey-chip"
            onClick={() => (capturing ? cancel() : start())}
          >
            {capturing
              ? preview
                ? formatHotkey(preview)
                : "Press keys…"
              : formatHotkey(settings.hotkey)}
          </button>
        </div>
        {error && (
          <div className="row">
            <div className="download-error" data-testid="hotkey-error">
              {error}
            </div>
          </div>
        )}
      </div>
    </>
  );
}
