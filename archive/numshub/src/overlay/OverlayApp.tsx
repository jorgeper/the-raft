// The overlay pill (SPEC FR-2 + FR-1.6). States: recording (live waveform +
// timer), transcribing (thinking shimmer), nothing-heard, no-model (Choose
// Model button). Driven entirely by events from the Rust side (or the mock).

import { useEffect, useRef, useState } from "react";
import { api, listen } from "../ipc/api";
import { BAR_COUNT, levelsToBars, pushLevel } from "../lib/waveform";

type OverlayState =
  | "hidden"
  | "recording"
  | "transcribing"
  | "nothing-heard"
  | "no-model";

export default function OverlayApp() {
  const [state, setState] = useState<OverlayState>("hidden");
  const [bars, setBars] = useState<number[]>(() => levelsToBars([]));
  const [elapsed, setElapsed] = useState(0);
  const historyRef = useRef<number[]>([]);
  const startedRef = useRef<number>(0);

  useEffect(() => {
    document.body.classList.add("overlay-body");
    const unlisteners: Array<() => void> = [];
    (async () => {
      unlisteners.push(
        await listen<{ state: string }>("show-overlay", ({ state }) => {
          historyRef.current = [];
          setBars(levelsToBars([]));
          if (state === "recording") {
            startedRef.current = Date.now();
            setElapsed(0);
          }
          setState(state as OverlayState);
        }),
        await listen("hide-overlay", () => setState("hidden")),
        await listen<number>("mic-level", (level) => {
          pushLevel(historyRef.current, level);
          setBars(levelsToBars(historyRef.current));
        }),
      );
    })();
    return () => unlisteners.forEach((u) => u());
  }, []);

  useEffect(() => {
    if (state !== "recording") return;
    const timer = setInterval(
      () => setElapsed(Math.floor((Date.now() - startedRef.current) / 1000)),
      500,
    );
    return () => clearInterval(timer);
  }, [state]);

  const mm = String(Math.floor(elapsed / 60)).padStart(1, "0");
  const ss = String(elapsed % 60).padStart(2, "0");

  return (
    <div
      className={`pill ${state !== "hidden" ? "visible" : ""}`}
      data-testid="overlay-pill"
      data-state={state}
    >
      {state === "recording" && (
        <>
          <span className="rec-dot" data-testid="rec-dot" />
          <div className="wave" data-testid="waveform">
            {bars.map((h, i) => (
              <i key={i} style={{ height: `${h}px` }} />
            ))}
          </div>
          <span className="pill-timer" data-testid="timer">
            {mm}:{ss}
          </span>
          <button
            className="pill-cancel"
            data-testid="cancel-btn"
            title="Cancel (Esc)"
            onClick={() => api.cancelDictation()}
          >
            ✕
          </button>
        </>
      )}
      {state === "transcribing" && (
        <div className="wave thinking" data-testid="thinking-wave">
          {Array.from({ length: BAR_COUNT }, (_, i) => (
            <i key={i} />
          ))}
        </div>
      )}
      {state === "nothing-heard" && <span className="pill-label">Nothing heard</span>}
      {state === "no-model" && (
        <>
          <span className="pill-label">Pick a model to start dictating</span>
          <button
            className="btn primary"
            data-testid="choose-model-btn"
            onClick={() => api.openSettings("models")}
          >
            Choose Model
          </button>
        </>
      )}
    </div>
  );
}
