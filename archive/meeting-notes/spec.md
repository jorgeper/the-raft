# Minutes — Local Meeting Notes App

**Spec v1.0 — 2026-07-11**

A cross-platform (macOS + Windows) desktop app for taking notes during in-person meetings. It records the room, transcribes speech in real time, separates and labels speakers, and lets you drop images into the timeline — all fully on-device. **No network, ever**, except one explicit, user-initiated model download during onboarding or in Settings.

"Minutes" is a working name; rename freely.

---

## 1. Goals & non-goals

### Goals
- One-click record → live transcript with speaker labels, viewable as a chat-style timeline.
- 100% local inference. The machine can be in airplane mode during every meeting.
- Speaker self-identification: someone says "I am Jorge" and all their past and future utterances are relabeled.
- Drag-and-drop images into the conversation timeline at the moment they're dropped.
- Portable conversation documents (save/open anywhere, double-click to open).
- User-selectable transcription and diarization models, chosen during OOBE and changeable in Settings.
- Modern, slick, minimalist UI.

### Non-goals (v1)
- Remote/VoIP meeting capture (system-audio loopback), meeting summaries, translation, mobile, collaboration/sync, audio playback with transcript-follow (audio is stored, playback UI can come later), editing utterance text.

---

## 2. Architecture

Tauri 2 application.

- **UI:** TypeScript + React in the Tauri webview. Minimal dependency footprint; custom CSS (no heavy component framework).
- **Core:** Rust, in-process. All audio and inference on background threads; results stream to the UI over Tauri event channels. No sidecar processes.

### 2.1 Pipeline

```
mic (cpal) ─→ ring buffer ─→ VAD segmenter ──┬─→ whisper.cpp (whisper-rs) ─→ text
                                             └─→ sherpa-onnx (sherpa-rs)  ─→ speaker embedding
                                                        │
                                              merger / speaker clusterer
                                                        │
                                          timeline events ─→ UI (Tauri events)
```

| Stage | Tech | Notes |
|---|---|---|
| Capture | `cpal` | CoreAudio (macOS) / WASAPI (Windows). 16 kHz mono f32. Default input device; device picker in Settings. |
| VAD | Silero VAD (ONNX, ~2 MB, bundled) | Splits speech into utterances; silence costs no inference. Utterance = speech bounded by ≥600 ms of silence, max 30 s (force-split at max). |
| Transcription | whisper.cpp via `whisper-rs` | Metal on macOS, Vulkan/CPU on Windows. Runs per finalized utterance, plus a rolling partial pass every ~1.5 s on the in-progress utterance for live feedback. |
| Diarization | sherpa-onnx via `sherpa-rs` | Speaker-embedding model per utterance + online clustering (cosine distance, threshold-based new-speaker creation, incremental centroid refinement). |
| Merger | Rust | Joins text + speaker per utterance, assigns ids/timestamps, emits events. |

### 2.2 Threading

- **capture thread:** device → lock-free ring buffer.
- **segmenter thread:** VAD over the ring buffer, emits utterance boundaries.
- **stt worker:** owns the whisper context; queue of utterances (bounded; if it backs up, partial-pass frequency degrades first, never final passes).
- **diar worker:** owns embedding model + clusterer.
- **merger:** joins results by utterance id (text may arrive after speaker or vice versa), emits `timeline/*` events.

Engine threads are supervised: a panic in any worker triggers engine restart with the same conversation state; the UI shows a transient banner ("Engine restarted — a few seconds may be missing").

### 2.3 Events (Rust → UI)

- `timeline/partial` — `{utterance_id, text}` (gray, in-progress bubble)
- `timeline/final` — full utterance item (see §4)
- `timeline/speaker-updated` — `{speaker_id, name, auto_named}` (rename, incl. "I am X")
- `engine/status` — recording | paused | stopped | restarting | error
- `audio/level` — RMS for the live waveform strip (~15 Hz)
- `models/download-progress` — OOBE/Settings only

Commands (UI → Rust): `start_recording`, `pause`, `resume`, `stop`, `save(path)`, `open(path)`, `rename_speaker`, `delete_item`, `add_image(path, at)`, `download_model(id)`, `delete_model(id)`, `remember_voice(speaker_id)`, `forget_voice(voice_id)`, plus settings getters/setters.

---

## 3. Models

### 3.1 Catalog

Shipped as a static JSON catalog inside the app (name, size, sha256, URL, engine, languages, speed/quality rating). v1 catalog:

**Transcription (whisper.cpp, GGUF/GGML):**
| Model | Size | Notes |
|---|---|---|
| tiny | 75 MB | fastest, lowest quality |
| base | 142 MB | |
| small | 466 MB | **default** — good realtime balance |
| large-v3-turbo | 1.6 GB | best quality, needs a strong machine |

**Diarization (sherpa-onnx):**
| Model | Size | Notes |
|---|---|---|
| pyannote-style segmentation | ~6 MB | **default**, bundled with embedding model below |
| speaker embedding (3D-Speaker / WeSpeaker ONNX) | ~30 MB | produces the vectors used for clustering and voice memory |

A second transcription engine (Parakeet via sherpa-onnx) is catalog-ready but post-v1.

### 3.2 Acquisition & storage

- Downloaded **once**, explicitly, during OOBE or from Settings → Models. Progress bar, resumable, sha256-verified. This downloader is the app's only network code and runs only on explicit user action.
- Stored in the platform app-data dir (`~/Library/Application Support/Minutes/models`, `%APPDATA%/Minutes/models`). Deletable per-model in Settings.
- Corrupt/missing model at load → prompt to re-download or pick another installed model.
- Silero VAD is small enough to bundle in the binary; it never needs downloading.

---

## 4. Data model

### 4.1 Document: `.mnote`

A conversation is one portable file: a zip container.

```
MyMeeting.mnote
├── conversation.json
├── audio.ogg            # Opus 24 kbps mono (~11 MB/hr); omitted if keep-audio is off
└── assets/
    └── img-<id>.<ext>   # dropped images, copied in as-is
```

### 4.2 `conversation.json`

```jsonc
{
  "schema_version": 1,
  "id": "uuid",
  "title": "Untitled conversation",        // editable
  "started_at": "2026-07-11T09:30:00-07:00",
  "ended_at": "2026-07-11T10:02:11-07:00",
  "engine": {
    "stt": {"engine": "whisper.cpp", "model": "small"},
    "diarization": {"engine": "sherpa-onnx", "model": "wespeaker-..."}
  },
  "speakers": [
    {
      "id": "spk-1",
      "name": "Jorge",                     // "Speaker 1" until renamed
      "color": "#5B8DEF",                  // assigned from a fixed 8-color palette
      "auto_named": true,                  // true if named via "I am X" or voice memory
      "embedding": [/* f32[], centroid — kept for voice-memory offers */]
    }
  ],
  "items": [
    {
      "type": "utterance",
      "id": "utt-0001",
      "speaker_id": "spk-1",
      "text": "Let's get started.",
      "t_start": 3.2,                      // seconds from recording start (pause-adjusted)
      "t_end": 4.9,
      "wall_time": "2026-07-11T09:30:03-07:00"
    },
    {
      "type": "image",
      "id": "img-0001",
      "file": "assets/img-0001.png",
      "wall_time": "2026-07-11T09:41:12-07:00",
      "caption": null                      // optional, user-editable
    }
  ]
}
```

`items` is ordered by wall time. Pauses simply produce a gap in wall times; `t_*` audio offsets exclude paused time and index into `audio.ogg`.

### 4.3 Saving, opening, recovery

- Native save/open dialogs; `.mnote` file association (double-click opens the app on both OSes).
- **Autosave:** while recording, the in-progress conversation is flushed to a recovery file in app-data every 30 s and on pause/stop. On launch after a crash: "Recover last conversation?"
- Stop → conversation stays open for review/renaming; Save (or ⌘S/Ctrl+S) writes the `.mnote`. Closing unsaved prompts.

### 4.4 App-level state (app-data dir)

- `settings.json` — models selected, keep-audio toggle, input device, theme.
- `voices.json` — opt-in voice library: `[{id, name, embedding, created_at, source_conversation}]`.
- `recovery/` — autosave snapshots.

---

## 5. Speaker identity

### 5.1 Diarization & labels

New clusters become "Speaker 1", "Speaker 2", … with palette colors. Clustering is online: early utterances may be re-assigned as centroids refine — the UI applies relabels silently (bubbles just update). Any speaker can be renamed manually by clicking their name chip; manual names set `auto_named: false` and are never overwritten automatically.

### 5.2 "I am X" self-identification (local, rule-based)

Runs on every **finalized** utterance:

1. Case-insensitive regex family: `\b(i am|i'm|my name is|this is) (<Name>)\b` where `<Name>` is 1–2 capitalized tokens (Whisper capitalizes proper nouns reliably).
2. Guards: reject if the candidate token is in a stoplist of common non-name continuations (sure, sorry, done, here, late, ready, recording, going, just, not, so, very, …); reject `this is` unless followed by exactly one or two name-like tokens and the utterance is short (< 8 words); reject names that match an existing *different* speaker with high embedding similarity conflict.
3. On match: rename that utterance's speaker (retro + future), set `auto_named: true`, emit `timeline/speaker-updated`, show a toast: **"Speaker 2 → Jorge"** with an Undo button (10 s).
4. If the speaker already has a manual name, ignore the match.

No LLM required. (Post-v1 option: a small local LLM pass for fuzzy phrasings, still offline.)

### 5.3 Voice memory (persistent, opt-in)

- After Stop, each unnamed-or-named speaker card shows **"Remember this voice"**. Clicking stores `{name, centroid embedding}` in `voices.json`.
- During future recordings, each *new* cluster's centroid is compared against the library (cosine similarity, conservative threshold ~0.7 tuned in testing). On match: auto-name with a toast + Undo, `auto_named: true`.
- Settings → Voices lists all remembered voices with delete buttons. Nothing is ever remembered without the explicit click.

---

## 6. Images

- Drag-and-drop anywhere on a conversation window (recording or viewing). File is copied into `assets/`, an `image` item is inserted at the current wall time (recording) or at the drop position between bubbles (viewing a saved conversation).
- Rendered as inline timeline cards (max-height ~320 px, click to zoom in a lightbox). Optional caption on click. Accepted: png, jpeg, gif, webp, heic (macOS).

---

## 7. UI

Design language: minimalist. System font stack, one accent color, 8-color speaker palette, generous whitespace, subtle motion (fade/slide for new bubbles), light/dark following the OS. No toolbars-of-buttons; controls appear where needed.

### 7.1 Home
- App name, a large **New conversation** button, and a recent-files list (title, date, duration, speaker count). Footer badge: **"100% local — no audio ever leaves this device."**

### 7.2 Conversation view (one view for live + saved)
- **Timeline:** chat-style bubbles, left-aligned, each with speaker color chip, name, and wall-clock time. Consecutive utterances from the same speaker group under one header. Images inline. Live partial text renders as a gray, italic in-progress bubble.
- **Waveform strip:** thin live level meter across the bottom while recording.
- **Control cluster** (floating, bottom center): ● Record → becomes ⏸ Pause / ■ Stop while recording. Elapsed-time counter. Paused state shows a subtle "paused" pulse.
- **Header:** editable title, engine indicator (model names, e.g. "whisper small · on-device"), Save.
- **Saved-conversation mode:** same layout, no record controls; renaming speakers, captioning images, deleting items, and inserting images remain available.

### 7.3 Settings
- **Models:** installed vs. available (from catalog) with sizes; download/delete; active transcription + diarization model pickers.
- **Voices:** remembered-voice list with delete.
- **Audio:** input device picker, keep-audio-in-document toggle (default on).
- **General:** theme (system/light/dark), storage-location info.

### 7.4 OOBE (first launch)
1. Welcome — one screen, the local-only promise up front.
2. Microphone permission (native prompt; denial → explainer + deep link to OS settings).
3. Choose transcription model — table with size / speed / quality, `small` pre-selected.
4. Choose diarization model — default pre-selected (one option in v1; screen exists for future).
5. Download with progress ("this is the only time Minutes uses the network — you can verify with your firewall").
6. Done → Home.

OOBE can be re-run from Settings. Skipping the download leaves the app usable as a viewer, with a "models needed" call-to-action on record.

---

## 8. Platform notes

- **macOS:** `NSMicrophoneUsageDescription`; hardened runtime + notarized DMG; Metal build of whisper.cpp; app is Apple Silicon-first (universal binary if practical).
- **Windows:** WASAPI capture; NSIS/MSI installer; Vulkan whisper build with CPU fallback detection at first run.
- **Performance targets** (M-series Mac / recent x86, `small` model): final transcript ≤ 2 s after end of utterance; partials every ~1.5 s; idle (recording, silence) CPU < 5%.

---

## 9. Error handling

| Failure | Behavior |
|---|---|
| Mic permission denied | Inline explainer + deep link to OS privacy settings; record disabled until granted. |
| Input device disappears mid-recording | Auto-pause + banner; resume when a device returns or user picks another. |
| Model missing/corrupt at load | Blocking dialog: re-download or choose another installed model. |
| Inference thread panic | Supervised restart; conversation continues; transient banner. |
| STT queue overload (slow machine) | Partial-pass frequency degrades first; if finals still lag, banner suggests a smaller model. |
| Disk full during autosave | Non-blocking warning; recording continues in memory. |
| Crash | Recovery prompt on next launch from last autosave. |
| Download interrupted | Resumable; sha256-verified before install. |

---

## 10. Testing

- **Rust unit tests:** VAD segmentation on synthetic audio; "I am X" matcher (table-driven: true positives, stoplist rejections, two-token names, `this is` guards); clustering assignment/refinement on synthetic embeddings; `.mnote` write→read round-trip; recovery-file replay.
- **Golden-audio integration test:** fixture WAV with 2–3 scripted speakers (including an "I am Alice" line) → assert transcript content (fuzzy), speaker count, and that Alice's earlier utterances got relabeled. Runs the real engine; CI-tagged to run on capable runners.
- **UI:** Playwright smoke tests against the dev build with a file-playback fake capture device — record/pause/stop flow, bubble rendering, drag-drop image, save/open, OOBE walk-through with a mocked catalog server.
- **Manual matrix per release:** macOS (Apple Silicon), Windows (with and without GPU).

---

## 11. Milestones

| # | Scope |
|---|---|
| M1 | Capture → VAD → whisper → live timeline; save/open `.mnote` (single speaker, no images) |
| M2 | Diarization + speaker labels/colors + manual rename + "I am X" |
| M3 | Images (drag-drop), pause/resume, autosave/recovery, keep-audio |
| M4 | OOBE wizard + model manager (download/delete/switch) |
| M5 | Voice memory (opt-in library), Settings polish, packaging (DMG/notarization, MSI), perf tuning |
