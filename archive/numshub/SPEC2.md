# SPEC2: Numshub — verified, step-gated onboarding

An increment over SPEC.md (which stays authoritative for everything else).
Read SPEC.md first. This spec replaces FR-7 (onboarding) and hardens the
permission flows that field testing broke.

**Field bugs this must fix for good:**

1. Onboarding advanced on button clicks, not on VERIFIED permission state —
   users finished setup with Accessibility not actually granted, and the
   hotkey then silently did nothing.
2. macOS 26 (Tahoe) gates menu-bar items behind a per-app "Allow in the Menu
   Bar" setting. Onboarding never mentioned it, so the app appeared to have
   no tray icon (the OS collapses the status item to zero width).
3. Nothing in the UI ever showed whether the hotkey listener was actually
   armed, so "it does nothing" had no diagnosis surface.

## 1. Design rule

**One screen = one gate = one verified fact.** A step's Continue control is
disabled (or the step auto-advances) based ONLY on a live check of the real
system state, polled while the screen is visible. Clicking "Open System
Settings" never advances the flow; the poll noticing the grant does. Each
step is shown one at a time — the user never sees the next dialog until the
current gate is verifiably satisfied or explicitly skipped where skipping is
allowed.

## 2. The wizard (FR-O1)

Ordered steps on macOS: **Welcome → Microphone → Accessibility → Menu Bar →
Model → Try it**. (Windows/dev: permission steps that don't apply are
omitted, not shown-and-skipped.)

Every permission step has exactly this layout: what Numshub needs, why (one
sentence, honest), a live status chip (`Checking… / Granted ✓ / Not granted`),
one primary action button that opens the right System Settings pane, and —
only where noted — a secondary explicit skip.

### Step: Microphone (FR-O2a)
- Status via `tauri-plugin-macos-permissions` `checkMicrophonePermission`,
  polled every 1 s while the step is visible.
- Primary button triggers the native prompt (`requestMicrophonePermission`);
  if the user already denied it, the button deep-links to System Settings →
  Privacy & Security → Microphone instead (request would silently no-op).
- Continue is enabled only when the check reports granted. Not skippable —
  a dictation app without a microphone is nothing.

### Step: Accessibility (FR-O2b)
- Status via `checkAccessibilityPermission`, polled every 1 s.
- Primary button: `requestAccessibilityPermission` (which deep-links).
- On grant: the Rust capture watcher (lib.rs) arms the hotkey within ~3 s;
  the step waits for BOTH the permission check AND the `capture-ready` event
  (or `get_app_info().capture_ready == true`) before showing "Granted ✓ —
  hotkey armed" and enabling Continue. Verifying the permission without
  verifying the listener is exactly bug #1.
- Skippable via an explicit "Skip — copy to clipboard instead of pasting"
  secondary action that states the consequence (no global hotkey, no paste).

### Step: Menu Bar (FR-O2c — NEW, macOS 26+)
- New Rust command `tray_item_visible() -> bool`: enumerates the app's own
  windows via `CGWindowListCopyWindowInfo` (the `core-graphics` crate is the
  sanctioned dependency) and returns whether a status-layer (layer 25) window
  owned by this process has width > 0. This is ground truth for "the icon is
  actually visible" — the same probe used to diagnose the field bug.
- Poll it every 1.5 s. If visible immediately (older macOS or already
  allowed), the step auto-advances without rendering — never show a gate
  that is already satisfied.
- Primary button opens System Settings ("Menu Bar" pane if the deep link
  resolves, else the System Settings root) with on-screen instructions:
  find Numshub → enable "Allow in the Menu Bar".
- Skippable ("I'll do this later") — the hotkey works without the icon —
  with the consequence stated.

### Step: Model (FR-O2d)
- As today (recommended + quick-start download with progress), but the gate
  is verified: Continue appears only when `list_models()` reports at least
  one model with `downloaded == true` AND `get_settings().active_model` is
  set. Selecting/downloading auto-activates as today.

### Step: Try it (FR-O2e)
- Shows a live readiness panel — three rows, each with its verified status,
  polling while visible: Microphone (check), Hotkey armed (capture_ready),
  Model active (settings + downloaded). Every row links back to its step on
  click if unsatisfied.
- A test text box invites a real dictation. "Finish setup" is always enabled;
  it is the ONLY place `onboarding_complete` is set to true.

## 3. Resume and re-run (FR-O3)

- On every launch with `onboarding_complete == false`, the wizard opens at
  the FIRST unmet gate, computed from live checks — never from a stored step
  index. A pure function decides it:
  `first_unmet_step(snapshot) -> StepId` where snapshot =
  `{ mic, accessibility, capture_ready, tray_visible, model_ready, platform }`
  (skippable steps the user explicitly skipped are recorded in settings as
  `onboarding_skips: string[]` and count as met on resume).
- Settings → General gains "Re-run setup", which clears
  `onboarding_complete` and `onboarding_skips` and reopens the wizard.
- Closing the settings window mid-onboarding does not mark anything complete.

## 4. Mock + tests

The browser mock gains a permission state machine so Playwright can walk the
gates: `window.__mock.grant("microphone" | "accessibility" | "menubar")`
flips the simulated state; `checkX`/`tray_item_visible`/`capture_ready`
answer from it; `?onboarding=1` starts ungranted.

- **U5** (Vitest): `first_unmet_step` — every permutation of the snapshot
  picks the correct step; skipped steps honored; non-mac omits mac-only steps.
- **E9a**: with `?onboarding=1`, the mic step is shown; Continue disabled;
  later steps not in the DOM; `__mock.grant("microphone")` → Continue
  enables and advances.
- **E9b**: accessibility step stays locked after `grant("accessibility")`
  alone if capture_ready is still false, and unlocks once the mock flips
  capture-ready (the two-fact gate).
- **E9c**: menu-bar step: locked → `grant("menubar")` → auto-advance; and the
  skip path records the skip and advances.
- **E9d**: model step gate: Continue absent until a mock download completes
  and the model is active.
- **E9e**: resume — reload with mic+accessibility pre-granted → wizard opens
  directly on the menu-bar step (not welcome); finish → `set_settings` called
  with `onboarding_complete: true` exactly once.
- Rust: **R9** `first_unmet_step` logic lives wherever it can be shared; if
  implemented in TS only, R9 is waived — but the E9 suite is mandatory.
  `tray_item_visible` itself is manual-verify only (CGWindowList needs a
  real window server) — do not fake a test for it.

## 5. Constraints

- E1–E8, U1–U4, R1–R8, I1–I2 must keep passing unmodified (except E-test
  fixtures that legitimately need the new mock permission fields).
- No new network access anywhere.
- SPEC.md §1 principles apply (local-only, no telemetry).
- Keep the existing visual language (styles.css) — this is a flow rework,
  not a redesign.

## 6. Definition of Done

1. `npm run validate` exits 0 with its complete output — R1–R8 (+R9 if
   implemented), U1–U5, E1–E9e, I1–I2, and `VALIDATION: ALL PASSED` —
   printed in the transcript.
2. `npm run tauri build` exits 0; .app path and size (< 80 MB) printed.
3. `grep -rn ".skip\|.only\|.todo" tests/` prints nothing.
4. README's permission/troubleshooting sections updated to match the new
   flow (the Menu Bar step exists now — say so).
5. ARCHITECTURE.md gains a short "Onboarding gates" note: the snapshot
   fields, who verifies each, and that `tray_item_visible` is the CGWindow
   probe.
6. Anything infeasible recorded in BLOCKERS.md — never game a check.

Manual checks after green (headless can't grant permissions): fresh-user run
(`rm -rf ~/Library/Application\ Support/com.numshub.app` + reset TCC toggles),
walking all five gates on macOS 26 and confirming each screen refuses to
advance until its toggle is really flipped.
