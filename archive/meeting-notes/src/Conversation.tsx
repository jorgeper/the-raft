import { useEffect, useMemo, useRef, useState } from "react";
import { backend } from "./ipc";
import type { Conversation as Conv, EngineStatus, Item, Speaker } from "./types";

interface Props {
  initial: Conv | null; // non-null when viewing a saved conversation
  initialAssetUrls: Record<string, string>;
  onHome: () => void;
}

interface Partial {
  id: string;
  text: string;
}

function fmtClock(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function fmtElapsed(s: number): string {
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, "0")}`;
}

const BARS = 24;

function Conversation({ initial, initialAssetUrls, onHome }: Props) {
  const viewing = initial !== null;
  const [items, setItems] = useState<Item[]>(initial?.items ?? []);
  const [assetUrls, setAssetUrls] = useState<Record<string, string>>(initialAssetUrls);
  const [speakers, setSpeakers] = useState<Speaker[]>(initial?.speakers ?? []);
  const [title, setTitle] = useState(initial?.title ?? "Untitled conversation");
  const [status, setStatus] = useState<EngineStatus>("idle");
  const [partial, setPartial] = useState<Partial | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [savedAs, setSavedAs] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<{ text: string; undo: () => void } | null>(null);
  const [keepAudio, setKeepAudio] = useState(true);
  const [renaming, setRenaming] = useState<string | null>(null);
  const speakersRef = useRef<Speaker[]>(initial?.speakers ?? []);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const levelsRef = useRef<number[]>(Array(BARS).fill(0));
  const [, forceLevel] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);
  const stuckToBottom = useRef(true);

  const model = initial?.engine.stt.model ?? "small";

  useEffect(() => {
    backend.getSettings().then((s) => setKeepAudio(s.keep_audio));
  }, []);

  useEffect(() => {
    const offs = [
      backend.onPartial((id, text) => setPartial({ id, text })),
      backend.onFinal((item) => {
        setPartial(null);
        setItems((prev) => [...prev, item]);
      }),
      backend.onLevel((rms) => {
        const arr = levelsRef.current;
        arr.push(Math.min(1, rms * 6));
        if (arr.length > BARS) arr.shift();
        forceLevel((n) => n + 1);
      }),
      backend.onStatus((s) => setStatus(s)),
      backend.onSpeakerUpdated((sp) => {
        const old = speakersRef.current.find((s) => s.id === sp.id);
        if (old && sp.auto_named && old.name !== sp.name) {
          const oldName = old.name;
          setToast({
            text: `${oldName} → ${sp.name}`,
            undo: () => {
              backend.renameSpeaker(sp.id, oldName);
              setToast(null);
            },
          });
          clearTimeout(toastTimer.current);
          toastTimer.current = setTimeout(() => setToast(null), 10000);
        }
        speakersRef.current = old
          ? speakersRef.current.map((s) => (s.id === sp.id ? sp : s))
          : [...speakersRef.current, sp];
        setSpeakers(speakersRef.current);
      }),
    ];
    return () => offs.forEach((off) => off());
  }, []);

  // Files dropped anywhere on the window land in the timeline.
  const itemsRef = useRef<Item[]>(items);
  itemsRef.current = items;
  useEffect(() => {
    return backend.onDragDrop(async (paths) => {
      for (const path of paths) {
        try {
          const last = itemsRef.current[itemsRef.current.length - 1];
          const { item, url } = await backend.addImage(path, last?.id ?? null);
          if (item.type === "image") {
            setAssetUrls((prev) => ({ ...prev, [item.file]: url }));
          }
          setItems((prev) => [...prev, item]);
        } catch (e) {
          setError(String(e));
          setTimeout(() => setError(null), 4000);
        }
      }
    });
  }, []);

  useEffect(() => {
    if (status !== "recording") return;
    const t = setInterval(() => setElapsed((e) => e + 1), 1000);
    return () => clearInterval(t);
  }, [status]);

  useEffect(() => {
    const el = scrollRef.current;
    if (el && stuckToBottom.current) el.scrollTop = el.scrollHeight;
  }, [items, partial]);

  const speakerOf = useMemo(() => {
    const map = new Map(speakers.map((s) => [s.id, s]));
    return (id: string): Speaker =>
      map.get(id) ?? { id, name: "Speaker", color: "#5B8DEF", auto_named: false };
  }, [speakers]);

  async function handleRecord() {
    setError(null);
    try {
      await backend.startRecording();
      setItems([]);
      setPartial(null);
      setElapsed(0);
      setSavedAs(null);
      speakersRef.current = [];
      setSpeakers([]);
    } catch (e) {
      setError(String(e));
    }
  }

  async function handleStop() {
    try {
      const conv = await backend.stopRecording();
      setItems(conv.items);
      speakersRef.current = conv.speakers;
      setSpeakers(conv.speakers);
    } catch (e) {
      setError(String(e));
    }
  }

  async function handleSave() {
    try {
      const path = await backend.saveAs();
      if (path) setSavedAs(path);
    } catch (e) {
      setError(String(e));
    }
  }

  // Group consecutive utterances by speaker.
  const groups = useMemo(() => {
    const out: { speakerId: string | null; items: Item[] }[] = [];
    for (const item of items) {
      const sid = item.type === "utterance" ? item.speaker_id : null;
      const last = out[out.length - 1];
      if (last && last.speakerId === sid && sid !== null) last.items.push(item);
      else out.push({ speakerId: sid, items: [item] });
    }
    return out;
  }, [items]);

  const paused = status === "paused";
  const stopped = status === "stopped";
  const canSave = (stopped || viewing) && items.length > 0;

  return (
    <div className="conversation">
      <header className="conv-header">
        <button className="btn-back" onClick={onHome} aria-label="Back to home">
          ‹
        </button>
        <input
          className="title-input"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          aria-label="Conversation title"
        />
        <span className="engine-chip">whisper {model} · on-device</span>
        {canSave && (
          <>
            <label className="keep-audio">
              <input
                type="checkbox"
                checked={keepAudio}
                onChange={async (e) => {
                  const checked = e.target.checked;
                  setKeepAudio(checked);
                  const s = await backend.getSettings();
                  await backend.setSettings({ ...s, keep_audio: checked });
                }}
              />
              Keep audio
            </label>
            <button className="btn-save" onClick={handleSave}>
              {savedAs ? "Saved" : "Save"}
            </button>
          </>
        )}
      </header>

      {error && <div className="banner-error">{error}</div>}

      <div
        className="timeline"
        ref={scrollRef}
        onScroll={(e) => {
          const el = e.currentTarget;
          stuckToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
        }}
      >
        {items.length === 0 && !partial && (
          <p className="empty-hint">
            {viewing
              ? "This conversation is empty."
              : "Press record and start talking — words appear here as they're spoken."}
          </p>
        )}
        {groups.map((g, gi) => {
          const first = g.items[0];
          if (first.type === "image") {
            const src = assetUrls[first.file];
            if (!src) return null;
            return (
              <figure className="image-card" key={first.id}>
                <img src={src} alt={first.caption ?? "Dropped image"} />
                <figcaption className="stamp">{fmtClock(first.wall_time)}</figcaption>
              </figure>
            );
          }
          const sp = speakerOf(first.speaker_id);
          return (
            <section className="group" key={`${first.id}-${gi}`}>
              <header className="group-head">
                <span className="chip" style={{ background: sp.color }} aria-hidden="true" />
                {renaming === `${sp.id}-${gi}` ? (
                  <input
                    className="speaker-rename"
                    defaultValue={sp.name}
                    autoFocus
                    aria-label="Speaker name"
                    onKeyDown={(e) => {
                      if (e.key === "Enter") e.currentTarget.blur();
                      if (e.key === "Escape") setRenaming(null);
                    }}
                    onBlur={(e) => {
                      const name = e.currentTarget.value.trim();
                      if (name && name !== sp.name) backend.renameSpeaker(sp.id, name);
                      setRenaming(null);
                    }}
                  />
                ) : (
                  <button
                    className="speaker-name"
                    title="Rename speaker"
                    onClick={() => setRenaming(`${sp.id}-${gi}`)}
                  >
                    {sp.name}
                  </button>
                )}
                <time className="stamp">{fmtClock(first.wall_time)}</time>
              </header>
              {g.items.map(
                (item) =>
                  item.type === "utterance" && (
                    <p className="bubble final" key={item.id}>
                      {item.text}
                    </p>
                  ),
              )}
            </section>
          );
        })}
        {partial && (
          <section className="group">
            <header className="group-head">
              <span className="chip chip-live" aria-hidden="true" />
              <span className="speaker-name-static">Listening</span>
            </header>
            <p className="bubble partial">{partial.text}</p>
          </section>
        )}
      </div>

      {toast && (
        <div className="toast" role="status">
          <span>{toast.text}</span>
          <button className="toast-undo" onClick={toast.undo}>
            Undo
          </button>
        </div>
      )}

      {!viewing && (
        <div className={`pill ${status}`}>
          {status === "idle" || stopped ? (
            <button className="rec-btn" onClick={handleRecord} aria-label="Record">
              <span className="rec-dot" />
            </button>
          ) : (
            <>
              <button
                className="ctl-btn"
                onClick={paused ? backend.resume : backend.pause}
                aria-label={paused ? "Resume" : "Pause"}
              >
                {paused ? "▶" : "⏸"}
              </button>
              <div className="wave" aria-hidden="true">
                {levelsRef.current.map((v, i) => (
                  <span key={i} style={{ height: `${4 + v * 24}px` }} />
                ))}
              </div>
              <span className="elapsed">{fmtElapsed(elapsed)}</span>
              <button className="ctl-btn stop" onClick={handleStop} aria-label="Stop">
                ■
              </button>
            </>
          )}
          {stopped && <span className="pill-note">recording ended</span>}
        </div>
      )}
    </div>
  );
}

export default Conversation;
