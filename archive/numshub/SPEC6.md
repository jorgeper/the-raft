# SPEC6: Numshub — visualizer effects and overlay themes

An increment over SPEC.md–SPEC5.md (authoritative elsewhere). The overlay's
recording visualization becomes a pluggable canvas engine with **15 built-in
effects**, the pill gets **12 built-in color themes** (fonts included), both
picked in a new Settings → Appearance section with a live preview — and users
can add their own themes as drop-in CSS files, following the proven
marky-mark pattern (metadata comment + custom-property contract).

**Explicit non-goal**: user JS/TS effect plugins. Assessed and deferred —
user code in the overlay webview needs sandboxing + a frozen API. The effect
engine below MUST be written against the small renderer interface anyway, so
a plugin loader can bolt on later without rework.

## 1. Effect engine (FR-A1)

- Replace the DOM-div waveform with a single DPR-aware `<canvas>` in the pill
  (live-text region and pill chrome are unaffected; SPEC3 layout stands).
- Renderer interface (the future plugin contract — keep it small and typed):
  `{ id, name, init(ctx, size), render(frame), dispose() }` where `frame` =
  `{ level, levels /* rolling history */, time, dt, colors, reducedMotion }`.
- `colors` come from the ACTIVE THEME's CSS variables (read via
  getComputedStyle once per theme change, not per frame) — every effect must
  use theme colors, never hardcoded ones, so any effect × any theme composes.
- requestAnimationFrame drives rendering; it MUST pause when the overlay is
  hidden and when the document reports `prefers-reduced-motion` the effect
  renders a calm, low-motion variant (each renderer decides; a static level
  indicator is acceptable).
- Registry in `src/overlay/effects/` — one module per effect + an index. The
  settings preview reuses the same engine with synthetic levels.

## 2. The 15 effects (FR-A2)

`classic-bars` (today's look, the default), `mirror-wave` (symmetric around
the midline), `oscilloscope` (single smooth line), `spectrum-blocks` (chunky
cells lighting up by level), `particle-fountain` (particles spray on speech),
`pulse-orb` (breathing circle with glow), `radial-rings` (rings expand from
center on peaks), `comet-trail` (a dot sweeping, trail length = level),
`ripple-pond` (concentric ripples on loudness), `starfield` (stars accelerate
with voice), `vu-needle` (analog meter), `dna-helix` (twisting strands,
amplitude = level), `fireflies` (drifting glows that brighten as you talk),
`glitch-bars` (bars with digital jitter on peaks), `aurora` (soft layered
waves like northern lights). Implementer has creative latitude on the exact
look; each must visibly respond to voice within ~100 ms and look idle-calm
in silence.

## 3. Themes (FR-A3)

- A theme is a set of CSS custom properties on the overlay root. The contract
  (document it in `THEMES.md` at repo root, marky-mark style):
  `--nh-pill-bg`, `--nh-pill-border`, `--nh-text`, `--nh-tentative-opacity`,
  `--nh-placeholder`, `--nh-timer`, `--nh-rec-dot`, `--nh-fx-primary`,
  `--nh-fx-accent`, `--nh-fx-glow`, `--nh-font`.
- The live-transcription text uses `--nh-font` and `--nh-text` — fonts are
  part of the theme (system stacks only for built-ins; no bundled font files).
- **12 built-ins**: `indigo` (today's look, default), `phosphor` (CRT green),
  `amber-terminal`, `vaporwave`, `nord`, `dracula`, `solarized-dark`,
  `solarized-light`, `rose-pine`, `catppuccin-mocha`, `newsprint` (light,
  serif), `high-contrast`. Each ships as CSS in `src/overlay/themes/` with
  swatch colors surfaced for the picker.

## 4. User themes (FR-A4) — the marky-mark pattern

- Folder: `<app data dir>/themes/` (created on first run alongside a copy of
  THEMES.md). One `.css` file per theme; leading metadata comment
  (`@name`, `@author`, `@variant`) with filename fallback.
- New Rust command `list_user_themes() -> Vec<{ id, name, variant, css }>`:
  reads the folder, caps file size (64 KB) and count (100), and REJECTS any
  file containing remote `url(http…)` references (SPEC §1 no-network stands;
  rejection surfaces in the picker as a disabled entry with the reason).
- User themes appear in the Appearance picker under a "Your themes" heading
  with a **Reload themes** button. Applying one injects its CSS into the
  overlay (and the preview) scoped to the pill root.
- Selection persists as `overlay_theme: string` (user theme ids prefixed,
  e.g. `user:my-theme`); a missing/invalid selection falls back to `indigo`
  without crashing — settings resilience per SPEC R5 spirit.

## 5. Settings (FR-A5)

- New Settings section **Appearance** (nav order: General, Appearance,
  Hotkey, Models, Cleanup): a live preview pill at the top (same engine,
  synthetic levels on a loop, current theme + effect applied), an effect
  picker (name + tiny animated thumbnail or static glyph — implementer's
  choice), a theme picker (swatch grid), and the Reload themes button.
- New settings fields (client-owned, `#[serde(default)]`-safe):
  `overlay_effect: String` (default `classic-bars`), `overlay_theme: String`
  (default `indigo`).
- The overlay learns the active effect/theme via the `show-overlay` payload
  (extend it) plus a `get_settings` read at overlay startup; changing either
  in Settings applies to the NEXT recording (live re-theming of a visible
  overlay is a nice-to-have, not required).

## 6. Tests

- **U8** (effect registry): exactly 15 entries, unique ids, default present;
  every renderer runs `init` + 10 `render` frames against a stub 2D context
  without throwing and issues at least one draw call; every renderer honors
  the interface (has dispose); no renderer references a color literal in its
  draw calls (they must pull from `frame.colors` — enforce however is
  practical, e.g. stub colors with sentinel values and assert they appear).
- **U9** (themes): exactly 12 built-ins, each defining every contract
  variable; metadata parser (name/author/variant + filename fallback);
  remote-url rejection; unknown selection falls back to default.
- **R11** (Rust): `list_user_themes` — temp dir: valid file parsed, oversize
  file rejected, `url(https://…)` file rejected with reason, missing dir =
  empty list; settings fields default correctly from legacy JSON.
- **E13a**: Appearance section renders preview + both pickers; selecting an
  effect and a theme persists via set_settings (mock) and survives reload.
- **E13b**: overlay applies them — `show-overlay` with effect/theme in the
  payload → pill carries `data-effect`, the canvas is present, and a contract
  CSS variable on the pill root matches the selected theme.
- **E13c**: user-theme flow through the mock (mock returns one fake user
  theme + one rejected entry): both listed, rejected one disabled with
  reason, applying the valid one injects its CSS.
- Existing suites keep passing; E10a must be updated only if the waveform
  test id moves to the canvas wrapper — semantic coverage may not shrink.

## 7. Definition of Done

1. `npm run validate` exits 0 with complete output — all existing suites plus
   U8, U9, R11, E13a–c — ending `VALIDATION: ALL PASSED`, printed in the
   transcript.
2. `npm run tauri build` exits 0; .app path + size (< 80 MB) printed.
3. `grep -rn ".skip\|.only\|.todo" tests/` prints nothing.
4. `THEMES.md` exists at repo root: the contract, a full example theme, the
   folder path per OS, and the reload workflow. README links to it and names
   the Appearance section.
5. ARCHITECTURE.md: a short "Overlay appearance" note — renderer interface,
   theme contract, why user JS effects are deferred and what the interface
   already guarantees for them.
6. Anything infeasible → BLOCKERS.md; never game a check.

Manual checks after green: flip through all 15 effects and several themes in
the preview while talking; drop a custom .css into the themes folder, Reload,
apply it; confirm reduced-motion (System Settings → Accessibility → Display →
Reduce motion) calms every effect.
