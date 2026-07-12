---
description: Build Gargoyle (macOS egress monitor) per spec.md, phase by phase
argument-hint: [phase number or specific task, e.g. "0" or "constellation view"]
---

# Goal: Build Gargoyle from spec.md

`spec.md` at the repo root is the authoritative specification for Gargoyle, a macOS menu-bar egress monitor & firewall (Swift 5.10+, SwiftUI, NetworkExtension + libpcap/pktap, GRDB/SQLite). Read it in full before doing anything.

**Argument:** `$ARGUMENTS` — an optional phase number or task to focus on. If empty, continue from wherever the project currently stands. If `all`, run every phase (0 through 3) in one continuous pass: do not stop at phase boundaries, and instead of waiting for direction, log the phase summary and verification evidence to `docs/PROGRESS.md` and immediately continue. In `all` mode, when a step is blocked on something only the user can do (sudo password, System Settings extension approval, code-signing setup), don't halt the run — record the blocker in `docs/PROGRESS.md`, stub or defer that verification, and keep building everything that doesn't depend on it; list all deferred verifications at the end.

## Process

1. **Assess state.** Check git log and the existing source tree to determine which phase from spec §11 is complete or in progress. On a fresh repo, start with Phase 0.
2. **Pick the next milestone** (or the one named in the argument) and break it into small, independently verifiable increments. Track them with the task list.
3. **Honor the spec's resolved decisions (§13) and non-goals** — do not relitigate them (no LLM layer, fail-closed firewall, Monitor as global default, bundled-static heuristics, etc.). If something genuinely ambiguous blocks progress, ask rather than invent.
4. **Build with TDD where the spec calls for it (§12):** rules-precedence engine, audit-log hash chain, and the flow pipeline (flow-replay harness feeding recorded flows) must be unit-tested. UI and capture code should at least compile and run cleanly.
5. **Verify before claiming done:** build and run the target, exercise the change end-to-end (e.g. Phase 0: run the pktap spike with sudo and confirm real flows print with correct process attribution).
6. **Commit at each working increment** with clear messages.
7. **Maintain `docs/PROGRESS.md`:** after each work session, record what's done, what's next, and any deviations from the spec (with reasons).

## Phase map (from spec §11)

- **Phase 0 — Spike:** SPM executable target `gargoyle-spike`: libpcap capture on the `pktap` pseudo-interface with per-packet process attribution (pid, process name), flows printed to console. Requires sudo. Also write a small probe that reports whether an `NEFilterDataProvider` system extension could be activated on this machine (for the managed-Mac decision in §3).
- **Phase 1 — Monitor + Audit:** `FlowTap` protocol with `PcapTap` implementation (and `FilterTap` where permitted), flow pipeline, SQLite audit store with hash-chained rows (GRDB), menu-bar app with popover (egress sparkline, recent events), UserNotifications alerts, learning mode.
- **Phase 2 — Rules + Firewall:** rules engine with precedence trace, rule profiles, approval prompts, per-app modes, hold-and-verdict via the content-filter extension (Tap A), "would-have-blocked" labeling on Tap B, review queue.
- **Phase 3 — Visual & watchers:** constellation view (Canvas + TimelineView) with time scrubber, activity heatmaps, heuristics DB, persistence monitor, quarantine watcher, mic/cam log.

## Project structure notes

- Phase 0 can live in a plain SwiftPM package (fastest iteration). The menu-bar app and system extension (Phase 1+) need an Xcode project for entitlements, code signing, and the extension target — plan the migration when Phase 0 is validated.
- Keep the tap layer strictly behind the `FlowTap` protocol from the start; everything downstream must be tap-agnostic per §2.2.

Stop at each phase boundary: summarize what was built, show verification evidence, and wait for direction before starting the next phase. (Exception: in `all` mode, write the summary to `docs/PROGRESS.md` and continue straight into the next phase.)
