# Numshub

Fast, fully-local voice dictation for macOS (Windows-portable). Press a hotkey
anywhere, talk, press it again — clean transcribed text lands at your cursor in
whatever app has focus.

- **Fully local.** Audio capture, speech-to-text, and cleanup all run on your
  machine. No cloud STT, no telemetry, no update pings — ever. The only network
  operations are (a) one-time model downloads you start yourself, verified by
  SHA-256, and (b) the optional transcript-enhancement pass, which is hard-locked
  to `localhost` endpoints in code.
- **Fast.** Parakeet V3 (the recommended model) transcribes well past real-time
  on Apple Silicon; the active model stays warm-loaded between dictations.
- **Simple.** One hotkey, one overlay, one menu-bar icon.

## How it works

1. Press **Right ⌘** (configurable, bare modifier keys supported). A small pill
   appears with a live waveform — the app you're typing in keeps focus.
2. Talk. Press the hotkey again (or use hold-to-talk mode). `Esc` cancels.
3. The transcript is cleaned — filler words (`um`, `uh`, …), bracketed noise
   tags, and stuttered repeats are stripped — and pasted at your cursor. Your
   previous clipboard contents are restored right after.

The menu-bar icon gives you: start/stop dictation, copy or retry the last
transcription, your five most recent transcriptions, and Settings.

## Models

Numshub ships no models; pick one in Settings → Models (or during onboarding):

| Model | Size | Languages | Notes |
| --- | --- | --- | --- |
| **Parakeet V3** (recommended) | ~460 MB | 25 European | Best speed/quality balance (ONNX) |
| Whisper Large v3 Turbo | ~1.6 GB | 99 | Best multilingual (whisper.cpp, Metal) |
| Whisper Small | ~470 MB | 99 | Mid-size multilingual |
| Whisper Tiny | ~75 MB | 99 | Quick start; used by the test harness |

The catalog is data-driven: adding a model is one new entry in
`src-tauri/models.json` (id, engine family, URL, SHA-256, size) — no code
changes.

## Optional AI enhancement (still local)

Settings → Cleanup can pipe each transcript through a small local LLM for
punctuation/grammar repair and spoken self-corrections ("…no wait, Wednesday").
It's **off by default** and only accepts localhost endpoints:

```bash
brew install ollama
ollama pull qwen3:4b
# then enable Enhancement in Settings → Cleanup and press Test
```

If enhancement takes longer than 5 seconds, Numshub pastes the plain cleaned
text instead — dictation never waits on a slow model.

## Permissions (macOS)

- **Microphone** — to hear you. Prompted on first recording.
- **Accessibility** — for two things only: listening for the global hotkey
  (including bare modifiers, which the sanctioned hotkey APIs can't do) and
  pressing ⌘V to paste. Without it, Numshub degrades gracefully to
  copy-to-clipboard. Grant it in System Settings → Privacy & Security →
  Accessibility.

Numshub is distributed outside the Mac App Store because sandboxed apps cannot
synthesize paste keystrokes.

## Build

Prerequisites: Rust (stable), Node 20+, Xcode Command Line Tools, cmake.

```bash
npm install
npm run tauri build        # produces the .app under src-tauri/target/release/bundle
npm run tauri dev          # development mode
npm run validate           # full test harness (R, U, E, I suites)
```

`npm run validate` downloads Whisper Tiny (~75 MB) once into
`~/.cache/numshub-validate/` for the integration test; everything else runs
offline.

## Architecture

See [ARCHITECTURE.md](ARCHITECTURE.md) for the module map, the
platform-abstraction boundary for the Windows port, and measured performance
numbers. The build stands on excellent open source: patterns adapted from
[Handy](https://github.com/cjpais/Handy) (MIT),
[transcribe-rs](https://github.com/cjpais/transcribe-rs),
[handy-keys](https://github.com/handy-computer/handy-keys),
[tauri-nspanel](https://github.com/ahkohd/tauri-nspanel), and
[whisper.cpp](https://github.com/ggml-org/whisper.cpp).
