# SPEC4: Numshub — "Fix in setup" recovery paths

An increment over SPEC.md/SPEC2.md/SPEC3.md (authoritative elsewhere). When
permissions drift out of whack after setup (Accessibility revoked, new build
re-keyed the grant, hotkey dead), every place the user can notice the problem
must offer a one-click path back into the setup wizard — which, by SPEC2's
resume rule, always opens at exactly the broken gate.

## 1. The recovery entry point (FR-F1)

One frontend helper, used by every CTA below:

`startSetup(clearSkips?: StepId[])` — clears `onboarding_complete` (and
removes the given steps from `onboarding_skips`, so a previously-skipped
broken gate is genuinely re-checked), saves settings, and lets the existing
wizard take over. No stored step index — SPEC2 §3 gate resolution lands on
the first unmet gate automatically, which for a revoked Accessibility grant
IS the Accessibility screen.

## 2. Surfaces (FR-F2)

1. **Capture-dead banner** (the big one): whenever the settings window is
   showing its normal sections on macOS and `get_app_info().capture_ready`
   is false, render a slim warning banner above the content, on every
   section: "The dictation hotkey is inactive — Accessibility permission is
   missing or was re-keyed." with a **Fix in setup** button →
   `startSetup(["accessibility"])`. The banner polls (~2 s) and disappears
   by itself when capture becomes ready (e.g. the user fixes it in System
   Settings directly). Never shown mid-wizard or on non-mac.
2. **Hotkey section**: when `start_hotkey_capture` fails (today's error text
   "grant Accessibility first"), the inline error gains the same
   **Fix in setup** button.
3. **General → Re-run setup** stays as-is (full re-walk: clears
   `onboarding_complete` and ALL skips) — its copy gains "…if something
   stopped working (permissions, hotkey, models), this re-checks everything."

## 3. Mock + tests (FR-F3)

- Mock: `start_hotkey_capture` rejects when the simulated `captureReady` is
  false (mirrors the real command); `window.__mock.revoke("capture")` and
  `revoke("accessibility")` flip permissions off so tests can break a
  configured app.
- **E11a**: settings loaded with capture not ready → banner visible on
  General AND after switching to Models; click Fix in setup → wizard shows,
  `data-step="accessibility"`; grant accessibility+capture via the mock →
  wizard advances (proves the gate re-check is live, not a stale snapshot).
- **E11b**: capture ready → no banner in the DOM.
- **E11c**: Hotkey section with capture not ready → clicking the hotkey chip
  surfaces the inline error WITH the Fix in setup button; clicking it lands
  in the wizard at the accessibility step.
- **E11d**: a previously-skipped accessibility gate (settings carry the skip)
  is re-checked after Fix in setup — the wizard must NOT skip past it.
- Existing suites (R1–R10, U1–U6, E1–E10c, I1–I2) keep passing unmodified.

## 4. Definition of Done

1. `npm run validate` exits 0 with complete output — all existing suites plus
   E11a–d — ending `VALIDATION: ALL PASSED`, printed in the transcript.
2. `npm run tauri build` exits 0; .app path + size (< 80 MB) printed.
3. `grep -rn ".skip\|.only\|.todo" tests/` prints nothing.
4. README troubleshooting: one short paragraph — "hotkey stopped working →
   the banner / Fix in setup", and that Re-run setup re-checks everything.
5. Anything infeasible → BLOCKERS.md; never game a check.

Manual check after green: with the app configured and working, remove Numshub
from System Settings → Accessibility; within a couple of seconds the settings
window (open it via the tray) shows the banner; Fix in setup lands on the
Accessibility screen; re-grant; the wizard advances and the banner is gone.
