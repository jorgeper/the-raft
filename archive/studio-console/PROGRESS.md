# Build progress — Observability + Studio Console

Resume protocol: read this + `git log --oneline -10` + spec.md §6/§8. The verify
score (scripts/verify.sh, 9 checks) must never decrease.

## Streaming build (goal-streaming.md): 12/12 ✅ — 2026-07-07

All 9 original checks plus streaming checks 10–12, stable across three runs.
Commits: S1 (executor.stream + stream-json runtime + coalescer, 14 tests),
S2 (config flag + orchestrator/loop wiring + demo streaming + doc 07 + fixtures
regenerated from a real run), S3 (console live pane + buffers + feed filter,
45 console tests total), S4 (verify 12/12).

Residual risks / human checks:
1. The stream-json parser was validated against a REAL captured `claude` run
   (tests/data/claude-stream-sample.jsonl; --verbose confirmed required) — but
   watch one real `studio run --watch` session end to end with `make run` to see
   live streaming under load before trusting it operationally.
2. `make demo` visually: the live pane at the bottom of the dashboard should fill
   as prd/architect/reviewer stream, then show "(finished)".
3. Chunk cadence on a real long invocation (coalescer: 400 chars / 1s) — tune in
   studio/events.py:OutputCoalescer if the pane feels laggy or chatty.

## Console+observability build (goal.md → spec.md §8): 9/9 ✅ — 2026-07-07

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
