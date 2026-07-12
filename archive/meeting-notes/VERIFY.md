# Verification Record

## M3 — Images, Autosave/Recovery, Keep-audio (2026-07-12)

- `cargo test` — **20/20 pass** (adds: `.mnote` asset round-trip incl. audio bytes,
  pause continuity — ~2 s paused span dropped from session audio and every `t_end`
  stays inside the pause-adjusted buffer).
- `cargo test --test recovery` — **pass**: engine with 1 s autosave interval, simulated
  crash (no `stop()`); recovery JSON parses with the live transcript and the PCM file
  holds real audio; `recover` re-encodes it to Opus for a full save.
- `cargo test --test golden_two_speakers` — still green.
- `npx playwright test` — **3/3 pass** (image card renders from bundled assets on open).
- Save now honors the `keep_audio` setting (checkbox next to Save, persisted in
  `settings.json`); saving clears recovery files.
- Known M3 limits (deliberate): recovered sessions lose dropped-image *bytes* (their
  source paths die with the crash — items remain in the transcript); real drag-drop
  onto the app window needs a human hand — the command path and rendering are covered
  by tests, the drop event uses the documented Tauri webview API.

## M2 — Diarization + "I am X" (2026-07-12)

- `cargo test` — **19/19 pass** (adds: diarizer same-voice/different-voice/alternating
  clustering, namer positives/negatives/two-token-cap/punctuation, engine two-speaker
  session with `SpeakerUpdated` events).
- `cargo test --test golden_two_speakers` — **pass**: 4-utterance alice/bob conversation
  (Samantha + Daniel `say` voices) → exactly 2 speakers; "Well, I am Alice…" auto-names
  her speaker (`auto_named: true`); her **pre-introduction** utterance carries her
  speaker id (the retroactive property); Bob stays "Speaker N".
- `npx playwright test` — **3/3 pass** (adds: second speaker renders its own header +
  color, "Speaker 1 → Alice" toast appears, Undo restores the old name).
- Real-mic regression: transcript still exact, finalization 254/277 ms after segmenter
  close with the diarizer in the loop (no measurable latency cost).
- Clustering threshold 0.65 tuned on measured fixture similarities (same voice
  0.92–0.94, cross 0.56–0.62). TTS voices from one engine are artificially close;
  real-voice tuning may need to lower it — revisit during M5 polish with human audio.
- Deferred by design: cluster refinement (re-assigning early utterances between
  existing clusters mid-meeting).

# M1 Verification Record

**Date:** 2026-07-12 · **Machine:** Apple Silicon Mac, macOS 26.5.1 · **Model:** whisper `small` (Metal)

## Test suite

- `cargo test` — **11/11 pass**: `.mnote` round-trip, resampler ×2, WAV source streaming,
  VAD (silence / speech / 900 ms pause-split), whisper artifact filter, whisper fixture
  transcription, engine WAV-session integration, Opus encode magic bytes.
- `npx playwright test` — **2/2 pass** (mock backend at `?mock=1`): record flow renders
  partial → 2 final bubbles → stop → Save visible; open-saved renders title.

## Real-microphone end-to-end (definition-of-done)

`cargo test --test real_mic -- --ignored --nocapture` — records from the **real default
microphone** via cpal (48 kHz native → 16 kHz), while `afplay` speaks the two-sentence
fixture through the speakers into the room.

```
mic capture started at 48000 Hz native
finalized utterance 254ms after segmenter close
finalized utterance 259ms after segmenter close
== real-mic transcript: this is the first sentence. and after a pause, this is the second sentence.
== captured 9.6s of audio
test result: ok. 1 passed; 0 failed
```

- **Transcript accuracy:** both sentences exact.
- **Latency:** finalization ≈ 255 ms of whisper time after the 600 ms end-of-utterance
  silence window ⇒ ≈ 0.9 s from when a speaker stops talking to final text. Target was ≤ ~2 s. ✅
- Note: the room-audio path failed on the first run because system output was muted —
  the pipeline correctly produced *no* utterances from a silent room (VAD held at zero).

## UI visual check

Screenshots taken in mock mode (light + dark): home, live partial bubble, listening pill
with waveform + elapsed, stopped state with Save. Both themes render correctly.

## Not yet covered (known, deliberate)

- Interactive click-through of the packaged app window by a human (the same command/event
  path is covered by mock-UI Playwright + real-engine tests; `MINUTES_FAKE_MIC=<wav>` runs
  the full app against a file source for manual checks).
- Windows build, autosave/recovery (M3), diarization (M2), OOBE/model manager (M4).
