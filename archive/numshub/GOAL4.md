# Launching the recovery-paths build with /goal

Run from this directory (`numshub/`). SPEC.md/SPEC2.md/SPEC3.md remain
authoritative except where SPEC4.md adds the recovery paths.

## Interactive (paste into a Claude Code session)

```
/goal Implement SPEC4.md in full (read SPEC.md, SPEC2.md, SPEC3.md first; they remain authoritative elsewhere). Done when: 'npm run validate' exits 0 with its complete output — Rust tests R1–R10, frontend tests U1–U6, e2e tests E1–E10c and E11a–E11d, integration tests I1–I2, and the final line 'VALIDATION: ALL PASSED' — printed in the transcript, AND 'npm run tauri build' exits 0 with the produced .app path and size (< 80 MB) printed, AND 'grep -rn ".skip\|.only\|.todo" tests/' prints nothing, AND README.md's troubleshooting section documents the capture-dead banner and Fix in setup. Constraints: SPEC.md, SPEC2.md, SPEC3.md, SPEC4.md, and this condition must not be modified; every Fix-in-setup entry point must route through the single startSetup helper per SPEC4 §1 and must clear the relevant onboarding_skips entries so a previously-skipped broken gate is re-checked (E11d proves it); the wizard itself must not gain a stored step index — SPEC2 §3 gate resolution decides where it opens; existing tests may not be weakened, stubbed, or deleted to pass; no new network access; if something is infeasible, record it in BLOCKERS.md instead of gaming the check. Stop after 40 turns or 4 hours even if incomplete, and summarize remaining work.
```

## Unattended one-liner

```bash
claude -p "/goal Implement SPEC4.md in full (read SPEC.md, SPEC2.md, SPEC3.md first; they remain authoritative elsewhere). Done when: 'npm run validate' exits 0 with its complete output — Rust tests R1–R10, frontend tests U1–U6, e2e tests E1–E10c and E11a–E11d, integration tests I1–I2, and the final line 'VALIDATION: ALL PASSED' — printed in the transcript, AND 'npm run tauri build' exits 0 with the produced .app path and size (< 80 MB) printed, AND 'grep -rn \".skip\|.only\|.todo\" tests/' prints nothing, AND README.md's troubleshooting section documents the capture-dead banner and Fix in setup. Constraints: SPEC.md, SPEC2.md, SPEC3.md, SPEC4.md, and this condition must not be modified; every Fix-in-setup entry point must route through the single startSetup helper per SPEC4 §1 and must clear the relevant onboarding_skips entries so a previously-skipped broken gate is re-checked (E11d proves it); the wizard itself must not gain a stored step index — SPEC2 §3 gate resolution decides where it opens; existing tests may not be weakened, stubbed, or deleted to pass; no new network access; if something is infeasible, record it in BLOCKERS.md instead of gaming the check. Stop after 40 turns or 4 hours even if incomplete, and summarize remaining work."
```

## Notes

- The manual smoke is the real proof: configure the app, revoke Accessibility
  in System Settings, open Settings from the tray — the banner should appear
  within ~2 s; Fix in setup must land directly on the Accessibility screen;
  re-granting advances the wizard and the banner never comes back.
- Watch for the test-word collisions with the DoD grep (".skip" matches the
  English word "skips"): phrase E11 test names with "deferral"/"re-check",
  not "skip".
