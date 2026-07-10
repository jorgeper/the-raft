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

First-run setup walks these one screen at a time, and each screen verifies
the *actual* system state before it lets you continue — clicking a button
never advances the flow; the permission really appearing does. You can re-run
it anytime from Settings → General → "Re-run setup".

1. **Microphone** — to hear you. The wizard triggers the native prompt and
   waits until the permission is genuinely granted. Not skippable.
2. **Accessibility** — for two things only: listening for the global hotkey
   (including bare modifiers, which the sanctioned hotkey APIs can't do) and
   pressing ⌘V to paste. The wizard waits for the grant *and* for the hotkey
   listener to actually arm before continuing (grants made mid-session are
   picked up within ~3 s). Skippable — Numshub degrades to copy-to-clipboard.
3. **Menu Bar** (macOS 26+) — Tahoe decides which apps may show a menu-bar
   icon. The wizard checks whether Numshub's icon is *really* rendering (not
   just created) and walks you to System Settings → Menu Bar → "Allow in the
   Menu Bar" if it isn't. Skippable — the hotkey works without the icon.

Numshub is distributed outside the Mac App Store because sandboxed apps cannot
synthesize paste keystrokes.

## Troubleshooting

### The menu-bar icon doesn't appear (macOS 26 Tahoe)

macOS 26 gates third-party menu-bar items behind a per-app permission — the
status item is created but the system collapses it to zero width, so the app
runs fine with no visible icon. This affects many menu-bar apps, not just
Numshub ([tauri#13770](https://github.com/tauri-apps/tauri/issues/13770),
[tray-icon#273](https://github.com/tauri-apps/tray-icon/issues/273)).

To fix:

1. Open **System Settings → Menu Bar** (on some builds: System Settings →
   Control Center, "Menu Bar Only" section).
2. Scroll to the list of apps allowed in the menu bar.
3. Find **Numshub** and turn on **Allow in the Menu Bar**.
4. Quit Numshub (the hotkey still works — or `pkill -x numshub`) and relaunch
   it.

Notes:

- Numshub only appears in that list after it has been launched at least once
  from the `.app` bundle (not `tauri dev`).
- A crowded menu bar can also hide icons silently — on notched MacBooks,
  macOS drops items that overflow under the notch. Try removing an icon or
  two (⌘-drag them out) if the toggle alone doesn't do it.
- If Numshub never shows up in the list, the fallback is signing the bundle
  with a real Developer ID identity (`bundle > macOS > signingIdentity` in
  `tauri.conf.json`) — Tahoe ties menu-bar permissions to signed bundles.

### Dictation says "Pick a model" unexpectedly

The active model lives in `~/Library/Application Support/com.numshub.app/
settings.json` (`active_model`). If it's ever null despite a downloaded model,
pick the model again in Settings → Models. (A bug where saving any other
setting reset the active model was fixed in 0.1.0 — update if you're on an
older build.)

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

## Installing dev builds

The quickest loop for trying a new build:

```bash
npm run tauri build     # produces src-tauri/target/release/bundle/macos/Numshub.app
npm run install:app     # kills the running app, replaces /Applications/Numshub.app, relaunches
```

`install:app` does the equivalent of:

```bash
pkill -x numshub                                   # quit the running instance
rm -rf /Applications/Numshub.app                   # remove the previous version
ditto src-tauri/target/release/bundle/macos/Numshub.app /Applications/Numshub.app
open /Applications/Numshub.app
```

Notes:

- **Install to /Applications rather than running from `target/`.** macOS keys
  permissions (mic, Accessibility, menu-bar allowance) and the launch-at-login
  entry to the app's identity and path — a stable `/Applications/Numshub.app`
  keeps them attached across builds. Running the bundle straight out of
  `target/` works for a quick look, but every `tauri build` recreates that
  path and permissions get flaky.
- Use `ditto` (not Finder drag or `cp -R`) — it preserves the bundle metadata
  and code signature exactly.
- Dev builds are ad-hoc signed, and the signature changes with every build —
  macOS pins the Accessibility grant to the old signature, so the checkbox
  looks enabled while the new build is silently denied. `install:app` handles
  this by running `tccutil reset Accessibility com.numshub.app` on every
  install: each new build asks for Accessibility once, cleanly, instead of
  failing mysteriously. (With a real Developer ID signing identity configured
  in `tauri.conf.json`, grants persist across builds and the reset becomes
  unnecessary.)
- The mic permission and the Menu Bar allowance are keyed to the bundle id
  (`com.numshub.app`) and survive reinstalls; you should not need to re-grant
  them.
- `pkill -x numshub` is safe anytime — settings, history, and models live in
  `~/Library/Application Support/com.numshub.app/`, untouched by reinstalls.

### Full reset (true first run)

`rm -rf /Applications/Numshub.app` alone is NOT a clean uninstall — macOS
keeps state keyed to the bundle id: the microphone/Accessibility grants
(TCC), app data (settings, so onboarding stays "complete"), preferences, and
WebKit storage all survive. To wipe everything and get the untouched
first-run experience:

```bash
npm run clean:app     # runs scripts/deep-clean.sh
npm run install:app   # fresh install → full onboarding, mic prompt and all
```

What it removes: the bundle, `~/Library/Application Support/com.numshub.app`
(settings/history/**models — the big downloads**), mic + Accessibility grants
(`tccutil reset`), preferences, WebKit/caches/saved state, and the
launch-at-login agent.

Two things no script can reset — do them by hand for a 100% pristine run:

1. **Menu Bar allowance**: System Settings → Menu Bar → find Numshub → turn
   OFF "Allow in the Menu Bar" (Control Center owns this state; there is no
   public API or `tccutil` service for it).
2. Nothing else — everything else is covered.

To re-run just the wizard WITHOUT wiping anything (keeps models and
permissions): Settings → General → **Re-run setup**. Steps whose checks
already pass are skipped automatically, so a fully-configured app jumps
straight to the Try It screen.

## Architecture

See [ARCHITECTURE.md](ARCHITECTURE.md) for the module map, the
platform-abstraction boundary for the Windows port, and measured performance
numbers. The build stands on excellent open source: patterns adapted from
[Handy](https://github.com/cjpais/Handy) (MIT),
[transcribe-rs](https://github.com/cjpais/transcribe-rs),
[handy-keys](https://github.com/handy-computer/handy-keys),
[tauri-nspanel](https://github.com/ahkohd/tauri-nspanel), and
[whisper.cpp](https://github.com/ggml-org/whisper.cpp).
