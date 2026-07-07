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

## Milestone log

- O1: studio/events.py + emissions in orchestrator/GoalLoop/trackers + snapshot CLI
  (status/show --json) + 10 emission tests; agent-studio made pip-installable.
- O2: contract doc (architecture/07, in book index + verify-docs manifest), fixtures
  regenerated from a real `studio demo --keep` run, console README.
- C1: parser / tailer / state folding / snapshot seam / replay + --check; 26 tests.
- C2–C4: Textual app — dashboard (active agents + live feed with expandable events),
  board with pinned Needs-You, item detail (markdown comments + timeline), runs
  browser, help overlay; 12 more tests incl. 4 pilot smoke tests.
- C5: verify.sh 9/9, stable ×3.

## Gotchas for future work

- agent-studio demo sandbox path is printed as "kept sandbox: <path>"; verify.sh
  check 4 parses the `sandbox:` token — keep that output stable.
- The demo sandbox contains studio/config/studio.yaml precisely so the snapshot
  contract can be exercised there (verify check 5).
- pyproject addopts already has -q; don't pass another -q or the pass-count line
  disappears (same trap as agent-studio).
