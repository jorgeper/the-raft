# Launching the live-transcription build with /goal

Run from this directory (`numshub/`). SPEC.md + SPEC2.md remain authoritative
except where SPEC3.md adds the live-transcription feature.

## Interactive (paste into a Claude Code session)

```
/goal Implement SPEC3.md in full (read SPEC.md and SPEC2.md first; they remain authoritative elsewhere). Done when: 'npm run validate' exits 0 with its complete output — Rust tests R1–R10, frontend tests U1–U6, e2e tests E1–E10c, integration tests I1–I2, and the final line 'VALIDATION: ALL PASSED' — printed in the transcript, AND 'npm run tauri build' exits 0 with the produced .app path and size (< 80 MB) printed, AND 'grep -rn ".skip\|.only\|.todo" tests/' prints nothing, AND README.md documents the live-transcription toggle AND ARCHITECTURE.md contains the live-loop note with a measured live-pass duration per SPEC3 §6.5. Constraints: SPEC.md, SPEC2.md, SPEC3.md, and this condition must not be modified; the stop path must remain authoritative and unchanged per SPEC3 §2 (live passes may never alter, delay-fail, or replace the final transcription); the stabilizer must guarantee stable text never shrinks or rewrites (SPEC3 §4) with U6 proving it; existing tests may not be weakened, stubbed, or deleted to pass; no new network access; live mode must degrade gracefully (perf-guard interval stretching, waveform-only on engine failure) rather than ever breaking a recording; if something is infeasible, record it in BLOCKERS.md instead of gaming the check. Stop after 60 turns or 6 hours even if incomplete, and summarize remaining work.
```

## Unattended one-liner

```bash
claude -p "/goal Implement SPEC3.md in full (read SPEC.md and SPEC2.md first; they remain authoritative elsewhere). Done when: 'npm run validate' exits 0 with its complete output — Rust tests R1–R10, frontend tests U1–U6, e2e tests E1–E10c, integration tests I1–I2, and the final line 'VALIDATION: ALL PASSED' — printed in the transcript, AND 'npm run tauri build' exits 0 with the produced .app path and size (< 80 MB) printed, AND 'grep -rn \".skip\|.only\|.todo\" tests/' prints nothing, AND README.md documents the live-transcription toggle AND ARCHITECTURE.md contains the live-loop note with a measured live-pass duration per SPEC3 §6.5. Constraints: SPEC.md, SPEC2.md, SPEC3.md, and this condition must not be modified; the stop path must remain authoritative and unchanged per SPEC3 §2 (live passes may never alter, delay-fail, or replace the final transcription); the stabilizer must guarantee stable text never shrinks or rewrites (SPEC3 §4) with U6 proving it; existing tests may not be weakened, stubbed, or deleted to pass; no new network access; live mode must degrade gracefully (perf-guard interval stretching, waveform-only on engine failure) rather than ever breaking a recording; if something is infeasible, record it in BLOCKERS.md instead of gaming the check. Stop after 60 turns or 6 hours even if incomplete, and summarize remaining work."
```

## Notes

- The measured live-pass duration for ARCHITECTURE.md comes free: run the
  CLI (`numshub transcribe`) on growing prefixes of fixtures/jfk.wav with
  whisper-tiny, or instrument the live loop's own log line.
- Manual checks after green: `npm run tauri build && npm run install:app`,
  dictate a long paragraph — words should appear above the waveform as you
  speak with no rewriting of already-shown text; stop → the CLEANED text
  pastes (live view shows raw text; that difference is by design); Settings →
  General → toggle off → compact waveform-only pill returns.
- Watch CPU during a 1-minute dictation (Activity Monitor): re-transcription
  cost grows with utterance length; the perf guard should visibly stretch the
  update interval rather than pin a core.
