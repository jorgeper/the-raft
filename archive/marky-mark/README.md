# Marky Mark

> **⚠️ Alpha** — Marky Mark is pre-release software (`0.2.0-alpha.1`).
> Builds are unsigned, formats may still shift, expect rough edges.

A lightweight, fast, themeable markdown viewer for **macOS, Windows, and the
web**. Double-click a `.md` file to read it. Press ⌘E (Ctrl+E) to edit it.
Select text to comment on it.

- **Tauri 2** shell — ~6 MB app, native webview, instant launch. No Electron.
  Plus a **single self-contained HTML file** (`dist-web/index.html`) you can
  host on any static site: open files with the picker or drag-and-drop.
- **Seven built-in themes** (Crisp, Claude, Monokai, Dracula, Nord, Solarized
  Light, One Dark) and drop-in custom themes: one CSS file in
  `~/Library/Application Support/com.markimark.app/themes/` (☰ → Settings →
  Reload themes; *Import theme…* on web). See [THEMES.md](THEMES.md).
- **Edit mode** is a full-screen swap (⌘E, remappable in Settings), not a split view.
- **Comments** (experimental): select text → 💬. Threads, resolve, orphaning.
  Stored as a `foo.md.comments.json` sidecar (format-compatible with the
  `md-with-comments` project) **or embedded invisibly inside the markdown
  file** — pick in Settings.

## Download

Grab the [latest release](https://github.com/jorgeper/sandbox/releases/latest)
(tags are app-prefixed `marky-mark-v*`):

- **macOS** (Apple Silicon): `Marky Mark_<version>_aarch64.dmg` — unsigned:
  right-click → Open the first time, or `xattr -dc "/Applications/Marky Mark.app"`.
- **Windows** (x64): `Marky Mark_<version>_x64-setup.exe` — unsigned:
  SmartScreen → More info → Run anyway.
- **Web** (any platform): `marky-mark-web-<version>.html` — the whole app in
  one file; download and open it, or host it anywhere static.

Verify downloads against `SHA256SUMS.txt`. All versions:
[releases](https://github.com/jorgeper/sandbox/releases). How releases are
cut: [RELEASING.md](RELEASING.md).

## Develop

```bash
npm install
npm run dev          # browser shim (virtual fs) at localhost:1420
npm run tauri dev    # the real desktop app
npm run validate     # version lock-step + typecheck + unit + desktop/web e2e + cargo check + single-file check
npm run tauri build  # packaged .app / .dmg
npm run build:web    # single-file web app → dist-web/index.html
npm run licenses     # regenerate THIRD-PARTY-NOTICES.md (allowlist-guarded)
```

Windows: built by `.github/workflows/release.yml` (or cross-compiled from
macOS — see [WINDOWS.md](WINDOWS.md)).

License: [MIT](LICENSE) · Third-party: [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md)

Docs: [SPEC.md](SPEC.md) · [ARCHITECTURE.md](ARCHITECTURE.md) ·
[THEMES.md](THEMES.md) · [WINDOWS.md](WINDOWS.md) · [RELEASING.md](RELEASING.md)
