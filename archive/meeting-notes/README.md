# Minutes

Local meeting notes for macOS (and Windows, planned): live transcription,
speaker diarization, "I am Jorge" self-identification, drag-in images —
**100% on-device**. The only network code in the app is the model downloader,
which runs once, on explicit action, during onboarding or from Settings.

- `spec.md` — product spec (source of truth)
- `GOAL.md` — implementation goal + milestone definitions
- `VERIFY.md` — per-milestone verification evidence
- `docs/superpowers/plans/` — implementation plans per milestone

## Development

```bash
npm install
./scripts/make-fixtures.sh          # speech test fixtures (uses macOS `say`)
./scripts/fetch-models.sh small     # whisper model  (dev-only fetcher)
./scripts/fetch-models.sh embedding # diarization embedding model
npm run tauri dev
```

Tests:

```bash
(cd src-tauri && cargo test)                                  # unit + engine
(cd src-tauri && cargo test --test golden_two_speakers)       # diarization e2e
(cd src-tauri && cargo test --test recovery)                  # autosave/crash
(cd src-tauri && cargo test --test voice_memory)              # voice library
(cd src-tauri && cargo test --test real_mic -- --ignored)     # REAL microphone
(cd src-tauri && cargo test --test download_real -- --ignored)# real download
npm run e2e                                                   # UI (mock backend)
```

Useful env vars: `MINUTES_FAKE_MIC=<16k-mono.wav>` records from a file instead
of the mic (drives the full app without speaking); `MINUTES_MODELS_DIR`,
`MINUTES_DATA_DIR`, `MINUTES_AUTOSAVE_SECS` override defaults for tests.

## Release builds

`npm run tauri build` produces `src-tauri/target/release/bundle/`
(`Minutes.app` + `.dmg`). Two steps intentionally need a human:

1. **macOS notarization** — requires an Apple Developer account. Set
   `APPLE_CERTIFICATE`/`APPLE_ID` signing env vars per the
   [Tauri macOS signing guide](https://tauri.app/distribute/sign/macos/) and
   rebuild; unsigned builds run locally but Gatekeeper warns on other Macs.
2. **Windows MSI** — run `npm run tauri build` on a Windows machine
   (whisper.cpp falls back to CPU/Vulkan there; the cpal/WASAPI and
   sherpa-onnx paths are cross-platform by construction but have not yet been
   exercised on real Windows hardware).
