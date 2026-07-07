# Build progress — Observability + Studio Console

Resume protocol: read this + `git log --oneline -10` + spec.md §6/§8. The verify
score (scripts/verify.sh, 9 checks) must never decrease.

## FINAL: 9/9 ✅ — 2026-07-07

`scripts/verify.sh` exits 0, stable across three consecutive runs. Agent-studio
verify.sh stays 13/13 and verify-docs.sh green (now with architecture/07 in the
manifest). 38 console tests (parser, tailer, state folding, snapshot seam, replay,
renderable builders, 4 textual-pilot smoke tests); 10 new emission tests in
agent-studio (111 total there). Live integration proven against a freshly produced
demo event stream every verify run.

- **Commits:** O1 (events + emissions + snapshot CLI), O2 (contract doc + fixtures
  + console README), C1 (console core), C2–C4 (screens), C5 (verify green).
- **Known limitations:** read-only v1 (approve/re-route is v2 via the studio CLI);
  runs browser is live-mode only (fixture replay has no runs/ dir); replay caps
  inter-event gaps at 2s; POSIX terminals only.
- **Three things a human should check by hand:**
  1. The live dashboard against a real `studio run --watch` session (all automated
     checks used the demo stream; a real TTY run of `make run` was not possible here).
  2. `make demo` visually — colors, layout, and the feel of the replay at 20x.
  3. The contract doc (architecture/07) against any consumer you build next.

## Done

- Scaffolding: folders, .venv, pyproject (pytest asyncio_mode=auto), Makefile,
  scripts/verify.sh (all 9 checks implemented up front).

## Next

- O1: studio/events.py (EventLog/NullEventLog, seq, rotation, tails) + emission in
  orchestrator/loop/trackers + tests/test_events.py in agent-studio.
- O2: status --json, show <id> --json, demo --keep (+ config/studio.yaml written
  into the demo sandbox so snapshot commands work there), contract doc 07, add to
  verify-docs manifest, regenerate fixtures.

## Gotchas

- agent-studio demo sandbox path is printed as "sandbox: <path>"; verify.sh check 4
  parses that line — keep it stable when touching demo output.
- verify.sh check 5 needs the demo sandbox to contain studio/config/studio.yaml.
