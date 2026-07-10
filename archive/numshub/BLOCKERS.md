# Blockers / honest caveats

0. **macOS 26 has no public API for "is my menu-bar item visible?"** Control
   Center owns the per-app allowance and hosts visible third-party items, so
   even window-server enumeration misattributes them. The onboarding gate
   uses the best available signal (the app's own NSStatusBarWindow frame +
   occlusion, in-process) and additionally offers an explicit user
   attestation ("I can see the icon — continue") in case the heuristic and
   reality disagree on some future macOS build.

1. **Parakeet V3 performance numbers are unmeasured.** SPEC §7 sets a
   stop-to-paste target for Parakeet v3, but the goal constraint permits only
   the cached Whisper-tiny download in `scripts/validate-stt` — the ~460 MB
   Parakeet archive cannot be fetched during this run. What was tried: the
   Whisper-tiny path measures the identical pipeline (same audio, cleanup,
   delivery code; different engine call), and its numbers are recorded in
   ARCHITECTURE.md. Measuring Parakeet is a one-command manual follow-up after
   downloading it through the app: dictate once, read the
   "stop -> delivered in …" log line.

2. **Hotkey/paste end-to-end latency and permission flows need a human.**
   macOS Accessibility cannot be granted headlessly, so bare Right-⌘ capture,
   real paste-into-Terminal, clipboard restore, and overlay focus behavior are
   manual checks (listed in GOAL.md). The perf probe measures the overlay
   show path (0.29 ms), which is the app-controlled portion of the < 150 ms
   budget.
