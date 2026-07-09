# Launching the Numshub build with /goal

Run from this directory (`numshub/`), which should contain only `SPEC.md` and this
file. For an unattended run, enable auto/permissive mode so tool calls don't block.

## Interactive (paste into a Claude Code session)

```
/goal Implement SPEC.md in full. Done when: 'npm run validate' exits 0 with its complete output — Rust tests R1–R8, frontend tests U1–U4, e2e tests E1–E8, integration tests I1–I2, and the final line 'VALIDATION: ALL PASSED' — printed in the transcript, AND 'npm run tauri build' exits 0 with the produced .app path and size (< 80 MB) printed, AND 'grep -rn ".skip\|.only\|.todo" tests/' prints nothing, AND fixtures/jfk.wav exists and is exercised by the integration test, AND ARCHITECTURE.md and README.md exist with ARCHITECTURE.md stating the Windows platform-abstraction boundary and measured numbers for every SPEC.md §7 performance target. Constraints: SPEC.md and this condition must not be modified; tests must contain real assertions per SPEC.md §8 and may not be weakened, stubbed, or deleted to pass; the Playwright suite must drive the real settings and overlay UI through the mocked-IPC browser shim; the only network access permitted is the cached Whisper-tiny download in scripts/validate-stt; study https://github.com/cjpais/Handy (MIT) before writing the hotkey, overlay, audio, or paste code and adapt its patterns with attribution — do not copy code from VoiceInk (GPL); if something is infeasible, record it in BLOCKERS.md instead of gaming the check. Stop after 80 turns or 8 hours even if incomplete, and summarize remaining work.
```

## Unattended one-liner (overnight)

```bash
claude -p "/goal Implement SPEC.md in full. Done when: 'npm run validate' exits 0 with its complete output — Rust tests R1–R8, frontend tests U1–U4, e2e tests E1–E8, integration tests I1–I2, and the final line 'VALIDATION: ALL PASSED' — printed in the transcript, AND 'npm run tauri build' exits 0 with the produced .app path and size (< 80 MB) printed, AND 'grep -rn \".skip\|.only\|.todo\" tests/' prints nothing, AND fixtures/jfk.wav exists and is exercised by the integration test, AND ARCHITECTURE.md and README.md exist with ARCHITECTURE.md stating the Windows platform-abstraction boundary and measured numbers for every SPEC.md §7 performance target. Constraints: SPEC.md and this condition must not be modified; tests must contain real assertions per SPEC.md §8 and may not be weakened, stubbed, or deleted to pass; the Playwright suite must drive the real settings and overlay UI through the mocked-IPC browser shim; the only network access permitted is the cached Whisper-tiny download in scripts/validate-stt; study https://github.com/cjpais/Handy (MIT) before writing the hotkey, overlay, audio, or paste code and adapt its patterns with attribution — do not copy code from VoiceInk (GPL); if something is infeasible, record it in BLOCKERS.md instead of gaming the check. Stop after 80 turns or 8 hours even if incomplete, and summarize remaining work."
```

## Notes

- `/goal` requires Claude Code v2.1.139+, an accepted workspace trust dialog, and hooks
  enabled. The evaluator only judges what appears in the transcript — that's why the
  condition demands the full `npm run validate` output be printed, not just claimed.
- Prerequisites on this machine: Rust toolchain (`rustup`), Xcode command-line tools,
  Node 20+. The first `npm run tauri build` compiles the Rust host, whisper.cpp, and
  ONNX Runtime and can take a long while; that's expected. The integration test
  downloads Whisper tiny (~40 MB) once and caches it.
- The turn/time cap is a safety valve for an unattended run. If it hits the cap,
  re-issue the same goal in a fresh session to resume — the condition is idempotent.
- After it goes green, the fun parts are manual (permissions can't be granted
  headlessly): launch the .app, complete onboarding (mic + Accessibility), download
  Parakeet v3, then press Right-Cmd in Terminal/Mail/Notes and dictate. Verify the
  overlay never steals focus, Esc cancels, clipboard is restored after paste, and
  "Retry Last Transcription" works from the menu bar.
- Enhancement is off by default; to try it, `brew install ollama`, `ollama pull
  qwen3:4b`, then enable it in Settings → Cleanup and hit Test.
