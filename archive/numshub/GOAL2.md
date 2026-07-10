# Launching the onboarding rework with /goal

Run from this directory (`numshub/`). SPEC.md (v1) remains authoritative for
everything except onboarding; SPEC2.md defines this increment.

## Interactive (paste into a Claude Code session)

```
/goal Implement SPEC2.md in full (read SPEC.md first for context; it remains authoritative except where SPEC2.md replaces FR-7). Done when: 'npm run validate' exits 0 with its complete output — Rust tests R1–R8 (plus R9 if the step-resolution logic lands in Rust), frontend tests U1–U5, e2e tests E1–E8 and E9a–E9e, integration tests I1–I2, and the final line 'VALIDATION: ALL PASSED' — printed in the transcript, AND 'npm run tauri build' exits 0 with the produced .app path and size (< 80 MB) printed, AND 'grep -rn ".skip\|.only\|.todo" tests/' prints nothing, AND README.md's permissions/troubleshooting sections describe the new gated flow including the macOS 26 Menu Bar step, AND ARCHITECTURE.md contains the "Onboarding gates" note per SPEC2 §6.5. Constraints: SPEC.md, SPEC2.md, and this condition must not be modified; every onboarding step must gate on the live verified check defined in SPEC2 §2 (never on button clicks), shown one step at a time with resume-at-first-unmet-gate per §3; existing tests may not be weakened, stubbed, or deleted to pass; the Playwright suite must drive the real onboarding UI through the mocked-IPC shim with the __mock.grant permission state machine; no new network access; tray_item_visible must use a real CGWindowList probe (manual-verify only — do not fake a test for it); if something is infeasible, record it in BLOCKERS.md instead of gaming the check. Stop after 60 turns or 6 hours even if incomplete, and summarize remaining work.
```

## Unattended one-liner

```bash
claude -p "/goal Implement SPEC2.md in full (read SPEC.md first for context; it remains authoritative except where SPEC2.md replaces FR-7). Done when: 'npm run validate' exits 0 with its complete output — Rust tests R1–R8 (plus R9 if the step-resolution logic lands in Rust), frontend tests U1–U5, e2e tests E1–E8 and E9a–E9e, integration tests I1–I2, and the final line 'VALIDATION: ALL PASSED' — printed in the transcript, AND 'npm run tauri build' exits 0 with the produced .app path and size (< 80 MB) printed, AND 'grep -rn \".skip\|.only\|.todo\" tests/' prints nothing, AND README.md's permissions/troubleshooting sections describe the new gated flow including the macOS 26 Menu Bar step, AND ARCHITECTURE.md contains the \"Onboarding gates\" note per SPEC2 §6.5. Constraints: SPEC.md, SPEC2.md, and this condition must not be modified; every onboarding step must gate on the live verified check defined in SPEC2 §2 (never on button clicks), shown one step at a time with resume-at-first-unmet-gate per §3; existing tests may not be weakened, stubbed, or deleted to pass; the Playwright suite must drive the real onboarding UI through the mocked-IPC shim with the __mock.grant permission state machine; no new network access; tray_item_visible must use a real CGWindowList probe (manual-verify only — do not fake a test for it); if something is infeasible, record it in BLOCKERS.md instead of gaming the check. Stop after 60 turns or 6 hours even if incomplete, and summarize remaining work."
```

## Notes

- After it goes green, the decisive test is manual and needs a fresh machine
  state: `pkill -x numshub; rm -rf ~/Library/Application\ Support/com.numshub.app`,
  remove Numshub from System Settings → Privacy & Security → Accessibility and
  → Microphone, and turn OFF its Menu Bar allowance. Then `npm run install:app`
  and walk the wizard: each screen must refuse to advance until its toggle is
  really flipped, and the Try It screen's three status rows must all be green
  before you dictate.
- The capture watcher (lib.rs) already arms the hotkey within ~3 s of an
  Accessibility grant; the Accessibility gate rides on that plus the
  capture-ready signal.
