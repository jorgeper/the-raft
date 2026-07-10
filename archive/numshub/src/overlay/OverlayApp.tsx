// The overlay pill (SPEC FR-2 + FR-1.6). States: recording (live waveform +
// timer), transcribing (thinking shimmer), nothing-heard, no-model (Choose
// Model button). Driven entirely by events from the Rust side (or the mock).

import { useEffect, useRef, useState } from "react";
import { api, listen } from "../ipc/api";
import { EMPTY_LIVE, stabilize, type LiveText } from "../lib/liveText";
import { BAR_COUNT, levelsToBars, pushLevel } from "../lib/waveform";

type OverlayState =
  | "hidden"
  | "recording"
  | "transcribing"
  | "nothing-heard"
  | "no-model";

export default function OverlayApp() {
  const [state, setState] = useState<OverlayState>("hidden");
  const [live, setLive] = useState(false);
  const [liveText, setLiveText] = useState<LiveText>(EMPTY_LIVE);
  const [bars, setBars] = useState<number[]>(() => levelsToBars([]));
  const [elapsed, setElapsed] = useState(0);
  const [overflowing, setOverflowing] = useState(false);
  const historyRef = useRef<number[]>([]);
  const startedRef = useRef<number>(0);
  const liveTextRef = useRef<LiveText>(EMPTY_LIVE);
  const liveRegionRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    document.body.classList.add("overlay-body");
    const unlisteners: Array<() => void> = [];
    (async () => {
      unlisteners.push(
        await listen<{ state: string; live?: boolean }>("show-overlay", ({ state, live }) => {
          historyRef.current = [];
          setBars(levelsToBars([]));
          if (state === "recording") {
            startedRef.current = Date.now();
            setElapsed(0);
            // New recording: reset the stabilizer (SPEC3 FR-L4).
            liveTextRef.current = EMPTY_LIVE;
            setLiveText(EMPTY_LIVE);
          }
          setLive(state === "recording" && live === true);
          setState(state as OverlayState);
        }),
        await listen("hide-overlay", () => setState("hidden")),
        await listen<number>("mic-level", (level) => {
          pushLevel(historyRef.current, level);
          setBars(levelsToBars(historyRef.current));
        }),
        await listen<{ text: string }>("stream-text", ({ text }) => {
          liveTextRef.current = stabilize(liveTextRef.current, text);
          setLiveText(liveTextRef.current);
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

  // Fade the top edge only when the text really wraps past the visible area
  // (a single line stays fully solid).
  useEffect(() => {
    const el = liveRegionRef.current;
    if (!el) {
      setOverflowing(false);
      return;
    }
    setOverflowing(el.scrollHeight > el.clientHeight + 2);
  }, [liveText, live, state]);

  const mm = String(Math.floor(elapsed / 60)).padStart(1, "0");
  const ss = String(elapsed % 60).padStart(2, "0");

  const hasLiveText = liveText.stable !== "" || liveText.tentative !== "";

  return (
    <div
      className={`pill ${state !== "hidden" ? "visible" : ""} ${live ? "live" : ""}`}
      data-testid="overlay-pill"
      data-state={state}
      data-live={live ? "true" : "false"}
    >
      {state === "recording" && (
        <>
          {live && (
            <div
              className={`live-text ${overflowing ? "masked" : ""}`}
              data-testid="live-text"
              ref={liveRegionRef}
            >
              {hasLiveText ? (
                <p>
                  <span data-testid="live-stable">{liveText.stable}</span>
                  {liveText.stable && liveText.tentative ? " " : ""}
                  <span className="live-tentative" data-testid="live-tentative">
                    {liveText.tentative}
                  </span>
                </p>
              ) : (
                <p className="live-placeholder" data-testid="live-placeholder">
                  Listening…
                </p>
              )}
            </div>
          )}
          <div className="pill-row">
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
          </div>
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
