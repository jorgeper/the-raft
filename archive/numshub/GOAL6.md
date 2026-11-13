# Launching the effects & themes build with /goal

Run from this directory (`numshub/`). SPEC.md through SPEC5.md remain
authoritative except where SPEC6.md adds the appearance system.

## Interactive (paste into a Claude Code session)

```
/goal Implement SPEC6.md in full (read SPEC.md through SPEC5.md first; they remain authoritative elsewhere). Done when: 'npm run validate' exits 0 with its complete output — Rust tests R1–R11, frontend tests U1–U9, e2e tests E1–E12d and E13a–E13c, integration tests I1–I2, and the final line 'VALIDATION: ALL PASSED' — printed in the transcript, AND 'npm run tauri build' exits 0 with the produced .app path and size (< 80 MB) printed, AND 'grep -rn ".skip\|.only\|.todo" tests/' prints nothing, AND THEMES.md exists at repo root with the contract, a full example theme, and the folder path, AND ARCHITECTURE.md contains the "Overlay appearance" note per SPEC6 §7.5. Constraints: SPEC.md through SPEC6.md and this condition must not be modified; all 15 effects must render through the single renderer interface and pull every color from the active theme (U8 enforces it — no hardcoded draw colors); the 12 built-in themes must each define the full contract; user CSS themes must be size-capped and reject remote url() references per SPEC6 §4 with R11 proving it; no user JS/TS execution of any kind; rendering must pause when the overlay is hidden and calm under prefers-reduced-motion; existing tests may not be weakened, stubbed, or deleted to pass (E10a may be adapted to the canvas only without shrinking coverage); no new network access; if something is infeasible, record it in BLOCKERS.md instead of gaming the check. Stop after 60 turns or 6 hours even if incomplete, and summarize remaining work.
```

## Unattended one-liner

```bash
claude -p "/goal Implement SPEC6.md in full (read SPEC.md through SPEC5.md first; they remain authoritative elsewhere). Done when: 'npm run validate' exits 0 with its complete output — Rust tests R1–R11, frontend tests U1–U9, e2e tests E1–E12d and E13a–E13c, integration tests I1–I2, and the final line 'VALIDATION: ALL PASSED' — printed in the transcript, AND 'npm run tauri build' exits 0 with the produced .app path and size (< 80 MB) printed, AND 'grep -rn \".skip\|.only\|.todo\" tests/' prints nothing, AND THEMES.md exists at repo root with the contract, a full example theme, and the folder path, AND ARCHITECTURE.md contains the \"Overlay appearance\" note per SPEC6 §7.5. Constraints: SPEC.md through SPEC6.md and this condition must not be modified; all 15 effects must render through the single renderer interface and pull every color from the active theme (U8 enforces it — no hardcoded draw colors); the 12 built-in themes must each define the full contract; user CSS themes must be size-capped and reject remote url() references per SPEC6 §4 with R11 proving it; no user JS/TS execution of any kind; rendering must pause when the overlay is hidden and calm under prefers-reduced-motion; existing tests may not be weakened, stubbed, or deleted to pass (E10a may be adapted to the canvas only without shrinking coverage); no new network access; if something is infeasible, record it in BLOCKERS.md instead of gaming the check. Stop after 60 turns or 6 hours even if incomplete, and summarize remaining work."
```

## Notes

- The fun manual pass: Settings → Appearance, talk while flipping through all
  15 effects and the 12 themes in the live preview; then a real dictation
  with your favorites. Drop a hand-written .css into
  `~/Library/Application Support/com.numshub.app/themes/`, hit Reload themes,
  apply it. Finally toggle Reduce Motion in System Settings and confirm every
  effect calms down.
- Marky-mark (~/src/marky-mark, THEMES.md + themes/*.css) is the reference
  for the user-theme workflow and metadata format — same author, same taste.
- Watch the DoD grep: avoid the letter-sequences "skip"/"only"/"todo" in test
  names and comments (use "bypass"/"solely"/"pending" phrasing).
