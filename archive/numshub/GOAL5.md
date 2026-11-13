# Launching the wizard-navigation build with /goal

Run from this directory (`numshub/`). SPEC.md through SPEC4.md remain
authoritative except where SPEC5.md adds navigation and the full re-walk.

## Interactive (paste into a Claude Code session)

```
/goal Implement SPEC5.md in full (read SPEC.md, SPEC2.md, SPEC3.md, SPEC4.md first; they remain authoritative elsewhere). Done when: 'npm run validate' exits 0 with its complete output — Rust tests R1–R10, frontend tests U1–U7, e2e tests E1–E11d and E12a–E12d, integration tests I1–I2, and the final line 'VALIDATION: ALL PASSED' — printed in the transcript, AND 'npm run tauri build' exits 0 with the produced .app path and size (< 80 MB) printed, AND 'grep -rn ".skip\|.only\|.todo" tests/' prints nothing, AND README.md documents back-navigation and the full re-walk. Constraints: SPEC.md through SPEC5.md and this condition must not be modified; forward movement past an unmet gate must remain impossible from every navigation control (dots past the frontier inert, Continue disabled on unmet gates); the no-yank rule per SPEC5 §2.4 with E12d proving it; met steps must render their full instructions per SPEC5 §3; launch resume and Fix-in-setup must still open at the frontier (E9e and E11a–d unmodified and passing) while Re-run setup opens at welcome via session-only intent — the wizard must not gain a persisted step index; navigation logic must be a pure tested unit per SPEC5 §5; existing tests may not be weakened, stubbed, or deleted to pass; no new network access; if something is infeasible, record it in BLOCKERS.md instead of gaming the check. Stop after 40 turns or 4 hours even if incomplete, and summarize remaining work.
```

## Unattended one-liner

```bash
claude -p "/goal Implement SPEC5.md in full (read SPEC.md, SPEC2.md, SPEC3.md, SPEC4.md first; they remain authoritative elsewhere). Done when: 'npm run validate' exits 0 with its complete output — Rust tests R1–R10, frontend tests U1–U7, e2e tests E1–E11d and E12a–E12d, integration tests I1–I2, and the final line 'VALIDATION: ALL PASSED' — printed in the transcript, AND 'npm run tauri build' exits 0 with the produced .app path and size (< 80 MB) printed, AND 'grep -rn \".skip\|.only\|.todo\" tests/' prints nothing, AND README.md documents back-navigation and the full re-walk. Constraints: SPEC.md through SPEC5.md and this condition must not be modified; forward movement past an unmet gate must remain impossible from every navigation control (dots past the frontier inert, Continue disabled on unmet gates); the no-yank rule per SPEC5 §2.4 with E12d proving it; met steps must render their full instructions per SPEC5 §3; launch resume and Fix-in-setup must still open at the frontier (E9e and E11a–d unmodified and passing) while Re-run setup opens at welcome via session-only intent — the wizard must not gain a persisted step index; navigation logic must be a pure tested unit per SPEC5 §5; existing tests may not be weakened, stubbed, or deleted to pass; no new network access; if something is infeasible, record it in BLOCKERS.md instead of gaming the check. Stop after 40 turns or 4 hours even if incomplete, and summarize remaining work."
```

## Notes

- Manual smoke after green: on a fully configured app, Settings → General →
  Re-run setup — the wizard must start at Welcome and every subsequent screen
  shows its instructions with a green status; Back and the dots move freely;
  park on any met screen and confirm nothing yanks you forward while reading.
- Then break something for real (remove Accessibility in System Settings):
  Fix in setup must still land directly on the Accessibility screen, and the
  dots past it must be inert until it's re-granted.
