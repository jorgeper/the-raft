# Numshub security posture

Audited 2026-07-11 against the app's core promise: **everything runs locally;
nothing leaves this machine.** Method: source inventory of every egress path,
live socket observation of the running app, full dependency-tree review for
network-capable code (Rust and npm), `cargo audit` + `npm audit`, and abuse
testing of the one user-content injection point (theme CSS).

## The network surface, exhaustively

Runtime network code exists in exactly two modules, both intentional:

| Path | What | Guardrails |
| --- | --- | --- |
| `src-tauri/src/downloader.rs` | User-initiated model downloads | HTTPS-only URLs from the embedded catalog (`models.json`, R7-validated); the download command accepts registry ids only — arbitrary URLs are impossible; SHA-256 pinned per artifact and verified before install |
| `src-tauri/src/enhance.rs` | Optional transcript enhancement | OFF by default; endpoint hard-restricted to `localhost`/`127.0.0.1`/`[::1]`, validated at settings-write time AND re-validated before any I/O (R8 + enhance tests) |

Everything else — audio, transcription, cleanup, history, settings, hotkeys,
paste — has no network code at all. Empirical check: the running app holds
**zero open sockets** (`lsof -i` over repeated samples, idle and active).

The webview is bundled-assets-only, ships no `fetch`/XHR/WebSocket callers,
and is now locked down with a strict CSP (`default-src 'self'`; connect-src
limited to Tauri's IPC; no frames, objects, or form posts) as defense in
depth — if a bug or compromised dependency ever tried to phone home from the
UI, the platform would block it.

## Dependency review (662 Rust crates, 5 runtime npm packages)

- The only crate with runtime-reachable network capability is `reqwest`,
  used solely by the two modules above (`cargo tree -i` verified).
- `transcribe-rs` contains optional network clients (whisperfile/OpenAI) —
  **feature-gated off**; we compile `onnx, whisper-cpp, whisper-metal` only.
  Pinned to `=0.3.11` so a patch release can't change feature defaults.
- **No updater, telemetry, analytics, or crash-reporting crates** anywhere in
  the lockfile (name-scan of all 662 packages). `tauri-plugin-updater` is
  deliberately absent.
- Tauri's own reqwest usage is compiled only for `dev + mobile` — verified
  absent from the desktop build graph.
- npm runtime bundle (`react`, `react-dom`, `@tauri-apps/api`, two plugin
  API shims): zero network APIs; `npm audit`: **0 vulnerabilities** (dev
  tree included, after the vitest 4 upgrade).
- `cargo audit`: **0 vulnerabilities**; warn-only "unmaintained" notices are
  Linux-only (gtk3 family) or compile-time (proc-macro-error) — not in the
  macOS runtime path.
- Git dependency (`tauri-nspanel`) pinned to an exact revision, not a
  movable branch.

### Build-time (not runtime) network

Two things download during `cargo build`, never in the shipped app:
`ort-sys` fetches a prebuilt ONNX Runtime (SHA-256 pinned in the crate and
verified; build fails on mismatch), and Cargo/npm fetch dependencies.
whisper.cpp is vendored and compiled locally — no fetch. To eliminate even
the ONNX fetch, build against a local runtime via `ORT_LIB_LOCATION`.

## User-content injection: themes

Theme CSS is the only user-provided content the app renders. Rejected with a
visible reason: remote `url(…)` in any spelling, **any `@import`** (its
string syntax bypasses url() checks — found and fixed in this audit), and
**any CSS escape sequence** (`url(\68ttp…)` smuggling — same). Files are
size-capped (64 KB) and count-capped. CSS cannot invoke IPC; combined with
the CSP, a hostile theme file's worst case is looking ugly.

## Trust notes (judgment calls, documented)

- **Model hosts**: Whisper models come from the official `ggerganov/
  whisper.cpp` Hugging Face repo; Parakeet from `blob.handy.computer` (the
  Handy project's mirror). Both are integrity-pinned by SHA-256 in
  `models.json`, so a tampered file cannot install — the residual trust is
  availability, not integrity.
- **Permissions**: microphone (to hear you) and Accessibility (hotkey +
  paste). No screen recording, no network entitlements needed. The app is
  not sandboxed (Accessibility-based paste is incompatible with the Mac App
  Store sandbox) — standard for this app category.
- **Dev builds are ad-hoc signed**; for distribution beyond this machine,
  sign with a Developer ID and notarize.

## Verifying it yourself

```bash
# The app should hold zero sockets, ever (except during a model download):
lsof -i -P -a -p "$(pgrep -x numshub)"

# Watch live while dictating:
sudo tcpdump -i any -n "host not 127.0.0.1" & # then dictate; expect silence

# Re-run the audits:
cd src-tauri && cargo audit
npm audit
```
