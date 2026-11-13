# GOAL — Implement the Minutes app (spec.md v1)

Implement the "Minutes" app exactly as specified in `spec.md` (read it first — it is the source of truth; do not redesign settled decisions).

Build a Tauri 2 desktop app (macOS + Windows) for in-person meeting notes with a fully local pipeline: cpal mic capture → Silero VAD → whisper.cpp transcription (whisper-rs) + sherpa-onnx diarization (sherpa-rs), all in-process Rust on supervised background threads, streaming timeline events to a React webview UI.

## Milestones — work in order, commit at each green milestone

- **M1:** capture → VAD → whisper → live chat-style timeline; save/open `.mnote` (zip: `conversation.json` + `audio.ogg` + `assets/`); single speaker.
- **M2:** diarization, speaker labels/colors, manual rename, rule-based "I am X" self-identification with retroactive relabel + undo toast.
- **M3:** drag-drop images into the timeline, pause/resume, 30s autosave + crash recovery, keep-audio toggle.
- **M4:** OOBE wizard (welcome → mic permission → model pickers → one-time sha256-verified download) + Settings model manager.
- **M5:** opt-in voice memory (`voices.json`, cosine match on new clusters), Settings polish, packaging (notarized DMG, MSI).

## Hard constraints

- No network code anywhere except the explicit model downloader (OOBE/Settings). Everything else must work in airplane mode.
- Follow the `.mnote` schema, event names, commands, error-handling table, and UI structure (Home / Conversation view / Settings / OOBE) from `spec.md` verbatim.
- Minimalist UI: system font stack, one accent color, 8-color speaker palette, light/dark follows OS, no component-framework bloat.

## Definition of done (per milestone)

The spec's tests for that scope pass:

- Rust unit tests, including the table-driven "I am X" matcher and `.mnote` round-trip.
- Golden-audio integration test from M2 onward.
- Playwright smoke tests with a file-playback fake capture device.

Plus a real end-to-end run on this Mac — actually record mic audio and verify live transcript latency ≤ ~2s with the `small` model. Never claim a milestone done without showing the passing test output and the e2e result.

## Starting point

Start with M1: scaffold the Tauri project, get whisper.cpp building with Metal, then wire the pipeline.
