# Numshub Architecture

## Pipeline

```
Right ⌘ (handy-keys event tap)
   └─> pipeline.rs   Idle → Recording → Processing state machine (1 thread, serialized)
         ├─ audio.rs        cpal @ device native rate → mono downmix → RMS levels (~30 Hz)
         │                  → on stop: rubato resample to 16 kHz mono
         ├─ overlay.rs      non-activating pill (NSPanel), waveform from level events
         ├─ stt.rs          transcribe-rs: Parakeet (ONNX) | Whisper GGUF (whisper.cpp+Metal)
         ├─ cleanup.rs      pure filter: fillers, [artifacts], repeats, whitespace  ← R1–R4
         ├─ enhance.rs      optional localhost-only Ollama rewrite, 5 s timeout → fallback
         └─ paste.rs        clipboard save → write → ⌘V (enigo) → restore (~300 ms)
```

## Module map

**Rust host (`src-tauri/src/`)**

| Module | One purpose | Key tests |
| --- | --- | --- |
| `cleanup.rs` | Pure transcript filter (`clean(text, opts)`) | R1–R4 |
| `settings.rs` | Settings JSON + localhost endpoint guard | R5, R8 |
| `registry.rs` | Data-driven model catalog (`models.json`) | R7 |
| `history.rs` | 20-entry ring buffer + retained last WAV | R6 |
| `audio.rs` | cpal capture worker thread, resampling, WAV IO | resample/WAV tests |
| `stt.rs` | Engine abstraction (Whisper/Parakeet), `load_path` for CLI | exercised by I1 |
| `downloader.rs` | Resume-able downloads, SHA-256 verify, tar.gz extract | sha/cancel tests |
| `enhance.rs` | Ollama client, warmup, timeout fallback | localhost-guard tests |
| `hotkey.rs` | handy-keys manager thread, capture mode for the recorder UI | validated via binding parse |
| `overlay.rs` | Pill window: create/show/hide/position, level throttling | E6/E8 (UI side) |
| `pipeline.rs` | The dictation state machine and delivery | manual + E-suite |
| `paste.rs` | Clipboard write + synthesized ⌘V + restore | manual (needs AX) |
| `tray.rs` | Tray icon states + menu, hotkey labels | label test |
| `commands.rs` | Tauri IPC surface (mirrored by `src/ipc/mock.ts`) | E1–E8 |

**Frontend (`src/`)**: `ipc/` (typed API + browser mock), `settings/` (four
sections + onboarding), `overlay/` (the pill), `lib/` (pure helpers — U2–U4),
`store/` (U1).

The CLI (`numshub transcribe|clean|bench-clean`) exposes the same engine +
cleanup code paths headlessly; the validation harness (I1/I2) drives it.

## Windows platform-abstraction boundary

Everything below compiles cross-platform today (cpal, rubato, transcribe-rs,
enigo, handy-keys, arboard, reqwest are all Windows-capable). The
platform-specific seams, each isolated in one place:

| Concern | macOS implementation | Windows port point |
| --- | --- | --- |
| Overlay window | `overlay.rs::platform` (mac): tauri-nspanel non-activating panel | `overlay.rs::platform` (non-mac) already provides the `focusable(false)` + always-on-top window; add a `SetWindowPos(HWND_TOPMOST)` reassert after show if z-order flickers |
| Paste keystroke | `paste.rs::send_paste_keystroke`: ⌘ + kVK 9 | same fn, `cfg(windows)` arm: Ctrl + VK 0x56 (already written) |
| Hotkey backend | handy-keys event tap (Accessibility) | handy-keys `WH_KEYBOARD_LL` hook (no permission needed) — same API |
| Permissions | `tauri-plugin-macos-permissions` + onboarding step | step is skipped on non-mac (`Onboarding.tsx` builds the step list per platform) |
| Menu-bar-only | `Info.plist` `LSUIElement` | `skipTaskbar` on windows + tray only |
| Whisper accel | `whisper-metal` feature | swap to `whisper-vulkan` feature in Cargo target table |

Remaining Windows work is packaging (MSI/NSIS via `tauri build`), not code.

## Measured performance (SPEC §7)

Machine: Apple Silicon Mac (Darwin 25.5), release build, 2026-07-09.

| Target | Requirement | Measured |
| --- | --- | --- |
| Hotkey → overlay visible | < 150 ms | `show_state` → visible: **0.29 ms** (perf probe; the handy-keys event dispatch adds single-digit ms — end-to-end is dominated by nothing) |
| Stop → text pasted (Whisper tiny) | < 1 s | jfk.wav (11 s audio): inference **97–431 ms** (warm/cold Metal) + cleanup 0.06 ms + paste delays ~450 ms ⇒ **≈ 0.6–0.9 s** |
| Stop → text pasted (Parakeet v3, 15 s) | < 1.5 s | not measurable in this run — model download blocked by the harness's no-network constraint; see BLOCKERS.md. Published benchmarks put Parakeet ~10× faster than whisper-large-turbo on ANE-class hardware |
| Idle RSS | < 400 MB warm | app idle: **102 MB**; peak RSS with Whisper tiny loaded + inferring: **228 MB** (CLI, same engine code) |
| Idle CPU | < 1 % | **0.0 %** (ps, 6 s idle) |
| Cleanup filter, 1,000 words | < 1 ms | **59.6 µs** per run (bench-clean, 100 runs) |

Model load (Whisper tiny): 4.8 s cold file cache, 154 ms warm — which is why
the active engine is loaded once and kept resident (`state.rs`), not per
dictation.

## Onboarding gates (SPEC2)

The wizard never stores a step index. A snapshot of verified facts —
`{ microphone, accessibility, captureReady, trayVisible, modelReady,
platform }` — is polled live, and the pure function
`firstUnmetStep(snapshot, skips)` (src/lib/onboarding.ts, U5-tested) decides
what to show; the wizard resumes and auto-advances from that alone. Who
verifies each fact:

| Fact | Verifier |
| --- | --- |
| `microphone` / `accessibility` | tauri-plugin-macos-permissions checks, polled 1 s |
| `captureReady` | the hotkey service is actually armed (`get_app_info` + `capture-ready` event from the lib.rs capture watcher) — accessibility is a two-fact gate |
| `trayVisible` | `tray_item_visible` (src-tauri/src/tray_probe.rs): in-process AppKit probe of the app's NSStatusBarWindow — frame width + occlusion state, on the main thread. (CGWindowList is unreliable here: macOS 26's Control Center hosts visible third-party items, so the app's own server-side window list shows a zero-size placeholder when suppressed and nothing when visible.) The wizard also offers an explicit "I can see the icon" attestation since Apple ships no public API for this state |
| `modelReady` | registry: active model set AND its files on disk |

Explicit skips (accessibility, menubar) persist in
`settings.onboarding_skips` and count as met on resume.

## Design notes

- **One pipeline thread** serializes Idle→Recording→Processing, so double
  hotkey presses, Esc, menu clicks, and the 5-minute watchdog can't race.
- **The overlay never takes focus**: NSPanel with `nonactivating_panel` +
  `can_become_key_window: false`; levels are throttled and skipped entirely
  while hidden (hidden WebKit views still pay for every event).
- **Paste runs on the main thread** (macOS requirement), with the previous
  clipboard restored ~300 ms after ⌘V; missing Accessibility degrades to
  clipboard-only plus a notification.
- **The mock IPC shim** (`src/ipc/mock.ts`) mirrors `commands.rs` event-for-
  event, which is what lets Playwright drive the real settings/overlay UI in a
  plain browser.
- Patterns for the hard parts (bare-modifier hotkeys, non-activating overlay,
  clipboard restore timing, download state machine) were adapted from
  [Handy](https://github.com/cjpais/Handy) (MIT), with thanks.
