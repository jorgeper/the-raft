# SPEC10: Marky Mark v10 — release engineering (version, About, licenses, pipeline, docs)

Delta spec on top of SPEC.md–SPEC7.md **as implemented**. SPEC8 remains
unimplemented and its test numbers E42–E44 stay reserved. SPEC9 (the earlier
release-pipeline draft) is **superseded by this spec** — where the two
disagree, SPEC10 wins. No regressions: every existing behavior, the comment
sidecar and embedded-trailer formats, and all existing tests stay exactly as
they are. §8 is the definition of done.

Explicitly out of scope for v10 (do NOT build): code signing / notarization,
the Tauri auto-updater, Linux packages, macOS universal binaries, and hosted
web deployment. §5 notes the seams they will slot into.

---

## 1. Versioning (FR-V)

1. The app version becomes **`0.2.0-alpha.1`** and lives in three files that
   must move in lock-step: `package.json`, `src-tauri/tauri.conf.json`, and
   `src-tauri/Cargo.toml` (with `package-lock.json` / `src-tauri/Cargo.lock`
   refreshed to match). The **pre-release identifier is never stripped** from
   any of the three source files — not by scripts, not by hand-edits, not by
   builds.
2. **`scripts/release-prepare.mjs`**, wired as
   `npm run release:prepare -- <version> [--no-commit]`:
   - validates `<version>` is strict semver (pre-release and build metadata
     allowed; anything else exits 1 with a usage message);
   - if all three files already carry `<version>`, prints a **no-op** message
     and exits 0 without touching anything;
   - otherwise writes `<version>` into all three files with surgical string
     transforms (only the version line changes), refreshes `Cargo.lock`
     (`cargo metadata`) and `package-lock.json`
     (`npm install --package-lock-only`);
   - prints a `git diff --stat` scoped to exactly the three version files plus
     the two lockfiles;
   - commits `chore(marky-mark): release v<version>` — unless `--no-commit`,
     which leaves the working tree for inspection.
3. `scripts/validate.mjs` gains a cheap **version lock-step check**: the three
   files agree and the version is valid semver. Runs first; failure names the
   stale file.

## 2. `__APP_VERSION__` plumbing (FR-B)

1. `package.json` is the single source of truth at build time. Both Vite
   configs (`vite.config.ts`, `vite.web.config.ts`) — and `vitest.config.ts`,
   so unit tests see the same constant — `define`
   **`__APP_VERSION__`** as `JSON.stringify(pkg.version)`.
2. A global type declaration (`src/vite-env.d.ts`) makes `__APP_VERSION__`
   visible to TypeScript. App code reads the version **only** through this
   constant; it never fetches or re-parses `package.json` at runtime.

## 3. The About dialog (FR-A)

1. The overflow menu gains a sixth item, **`menu-about`** ("About"), between
   Help and the Settings footer. The menu now contains exactly six buttons:
   Open / Save / Save As / Help / About / Settings (§6 updates E13's count).
2. Activating it opens a modal (`data-testid="about-dialog"`, same
   overlay/modal pattern as the unsaved-changes prompt) showing:
   - the app badge and the app name **Marky Mark**;
   - the version, rendered from `__APP_VERSION__` as `v0.2.0-alpha.1`
     (`data-testid="about-version"`);
   - an **alpha notice** — this is pre-release software; expect rough edges;
   - **Developer: Jorge Pereira**;
   - the license: **MIT**.
3. Escape, clicking the backdrop, or the Close button dismisses it. No
   network, no runtime version lookup, nothing else in the dialog.

## 4. Third-party licenses (FR-L)

1. **`scripts/licenses.mjs`**, wired as `npm run licenses`, regenerates
   **`THIRD-PARTY-NOTICES.md`** from the real dependency graphs:
   - npm: every **production** dependency (dev deps excluded) resolved from
     `package-lock.json`, license read from each installed package;
   - Rust: every crate in the resolved graph via
     `cargo metadata --format-version 1` (workspace root excluded).
2. Output is **deterministic**: sorted by name@version, no timestamps — a
   second consecutive run produces a byte-identical file (zero diff).
3. **Allowlist guard**: the script carries an explicit allowlist of permissive
   license IDs. An `OR` expression passes if any branch is allowed; an `AND`
   expression only if all are. Any package with a disallowed or missing
   license fails the run (exit 1) naming the offenders — copyleft can never
   slip in silently.

## 5. Release pipeline (FR-P)

1. **`.github/workflows/release.yml`** (app-local, i.e.
   `marky-mark/.github/workflows/release.yml` — the canonical copy, checked
   by §8; RELEASING.md documents the one-time activation copy to the monorepo
   root as `.github/workflows/marky-mark-release.yml`, since GitHub only runs
   workflows from the repo root).
2. Triggers: `push` on tags **`marky-mark-v*`**, and `workflow_dispatch` with
   a `version` input (dry-runs produce a draft **prerelease**).
3. Jobs:
   - **`test`** (macos-latest): `npm ci`, `npx playwright install chromium`,
     `npm run validate`, plus a **version-check** step — the released version
     (tag suffix or dispatch input) must equal all three version files;
     mismatch fails naming the stale file. Rust via
     `dtolnay/rust-toolchain@stable`; cargo + npm caching.
   - **`build-macos`** (macos-latest, needs test): `npm run tauri build` →
     the `.dmg` (Apple Silicon), uploaded as artifact.
   - **`build-windows`** (windows-latest, needs test): `npm run tauri build
     -- --bundles nsis` → the NSIS `-setup.exe` (x64), native build.
   - **`build-web`** (ubuntu-latest, needs test): `npm run build:web`, rename
     `dist-web/index.html` → `marky-mark-web-<ver>.html`.
   - **`release`** (ubuntu-latest, needs all builds): download artifacts,
     fail if any asset is missing or exceeds **25 MB**, generate
     `SHA256SUMS.txt`, create a **draft** GitHub Release with a fixed header
     covering the unsigned-build escape hatches (macOS right-click → Open /
     `xattr -dc`; Windows SmartScreen → More info → Run anyway). Nothing
     auto-publishes.
4. Permissions: `contents: write` on the release job only; concurrency group
   `marky-mark-release-<ref>` cancels stale runs of the same tag.
5. Local build paths stay green: `npm run tauri build` (macOS `.app` under
   25 MB) and the WINDOWS.md route-B cross-build
   (`npm run tauri build -- --runner cargo-xwin --target
   x86_64-pc-windows-msvc --bundles nsis`) both succeed with the alpha
   version string intact.
6. Future seams (do not build): signing/notarization via secrets in the two
   build jobs; Linux as one more matrix leg; auto-updater after signing;
   hosted web via a `release: published` workflow.

## 6. Tests (FR-T)

The **only** permitted test changes — tests may not otherwise be weakened,
stubbed, or deleted:

1. **E13** — the menu-count assertion goes from exactly five to exactly
   **six**, with `menu-about` asserted alongside the existing five items.
2. **E45** (new, desktop e2e; E42–E44 stay reserved for SPEC8): open ☰ →
   About; the dialog shows the app name, the exact `package.json` version via
   `__APP_VERSION__`, an alpha notice, "Developer: Jorge Pereira", and MIT;
   Escape dismisses it.
3. **U16** (new unit test): version plumbing — `__APP_VERSION__` equals the
   `package.json` version with the pre-release identifier intact; the
   release-prepare semver validator accepts valid versions (incl.
   pre-releases) and rejects garbage; the version-apply transforms rewrite
   only the version field of each of the three files and are idempotent.

## 7. Docs & legal (FR-D)

1. **`LICENSE`** — MIT, `Copyright (c) 2026 Jorge Pereira`.
2. **`README.md`** — an **alpha banner** up top; a **Download** section with
   one line per platform (macOS `.dmg`, Windows `-setup.exe`, web `.html`)
   pointing at the repo's `/releases/latest`, plus a link to all `/releases`;
   license + notices pointers.
3. **`RELEASING.md`** — two flows, each with the exact commands: the **Claude
   Code flow** (ask Claude to cut the release; it runs release:prepare,
   validates, tags, and hands the pushes back — the guard hook means the
   human runs `git push` themselves) and the **manual flow** (release:prepare
   → push → tag → push tag → watch → smoke-test draft → publish).
4. **`THIRD-PARTY-NOTICES.md`** — generated by §4, committed.
5. **`ARCHITECTURE.md`** — documents the `__APP_VERSION__` plumbing, the
   release pipeline topology (triggers → test gate → three builds → draft
   release), and the license allowlist guard.

## 8. Definition of Done (the /goal condition verifies exactly this)

1. `npm run validate` exits 0 with complete output — U1–U16, E1–E41 + E45,
   W1–W4, the single-file check, final line `VALIDATION: ALL PASSED`.
2. `grep` shows **0.2.0-alpha.1** in `package.json`,
   `src-tauri/tauri.conf.json`, and `src-tauri/Cargo.toml`.
3. `npm run release:prepare -- 0.2.0-alpha.2 --no-commit` prints a diffstat
   touching exactly the three version files plus lockfiles (tree restored
   afterward); a same-version rerun reports a no-op.
4. `npm run licenses` exits 0 and regenerates THIRD-PARTY-NOTICES.md with
   zero diff on a second consecutive run.
5. `npm run tauri build` (macOS) exits 0 — `Marky Mark.app` path and size
   (< 25 MB) printed. The Windows NSIS cross-build exits 0 with installer
   path and size printed (or BLOCKERS.md documents an honest new failure).
6. `ls dist-web/` shows exactly `index.html`, size printed.
7. `.github/workflows/release.yml` parses cleanly (actionlint if available,
   else a YAML parse check printed).
8. LICENSE, README.md, RELEASING.md, THIRD-PARTY-NOTICES.md all exist with
   the §7 contents. ARCHITECTURE.md covers §7.5.
9. `grep -rn ".skip\|.only\|.todo" tests/` prints nothing;
   `git diff --stat SPEC.md … SPEC10.md` is empty.
