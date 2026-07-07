# Goal prompt for /goal — streaming agent output

Run from the sandbox root: `/goal "$(sed '1,/^---$/d' studio-console/goal-streaming.md)"`

---
Implement the streaming-output addendum specified in
`/Users/jorgeper/src/sandbox/studio-console/spec-streaming.md`, working only inside
`/Users/jorgeper/src/sandbox/agent-studio/` and
`/Users/jorgeper/src/sandbox/studio-console/`.

GOAL (the only exit condition): `studio-console/scripts/verify.sh` exits 0 with the
THREE NEW checks (10–12 from spec-streaming.md §6) appended AND all nine existing
checks still passing — which transitively keeps agent-studio's verify.sh (13/13)
and verify-docs.sh green. Weakening any existing check is failure; do not stop
before everything is green.

Read first, once: spec-streaming.md; the current studio/runtime/*, studio/events.py,
studio/orchestrator.py (_invoke), studio/loop.py (the runtime call), studio/demo.py;
studio_console/{state,app}.py and widgets/panels.py; docs/architecture/07. Then
VERIFY the current `claude -p --output-format stream-json` line format against live
Claude Code docs (context7: /websites/textual_textualize_io is NOT it — resolve
Claude Code / Agent SDK docs) before writing the parser; record what you found in
DECISIONS.md. Capture a small real or documented sample into
agent-studio/tests/data/ for the parser test. No other web use.

How to work — hill-climb:
1. FIRST append checks 10–12 to studio-console/scripts/verify.sh exactly per §6.
   Baseline the score in PROGRESS.md; the failing-check count must only decrease.
2. Milestones S1→S4 (spec §4), one commit each, TDD inside each. The runtime change
   must be strictly backward compatible: on_output=None is byte-for-byte today's
   behavior, and every existing test in both repos must pass UNMODIFIED (except
   fixture files, which get regenerated).
3. Regenerate both console fixtures from a REAL `studio demo --keep` run after S2 —
   never hand-edit them. The demo's scripted agents must stream a few chunks each
   so fixtures (and the pilot test) carry agent_output events.
4. Coalescer discipline: injectable clock, tested flush-by-size AND flush-by-time
   AND final done-flush; a runaway stream must not flood events.jsonl.
5. Console: agent_output stays OUT of the feed by default (toggle `o`); the live
   pane truncates to its last lines — verify with the pilot, not by assumption.
6. Self-review with `make demo` (replay) before the S3 commit: does the live pane
   read naturally at 20x? Record judgment calls in studio-console/DECISIONS.md;
   never block on a human.

Stop rules: same failing check 10 consecutive attempts with no measurable progress
→ BLOCKED report in studio-console/PROGRESS.md, commit, stop. If the stream-json
format cannot be confirmed from docs, implement against the documented sample you
captured, mark the parser tolerant-by-default (skip unknown line types), and note
the residual risk in PROGRESS.md — that is not a blocker.

Hard boundaries: touch nothing outside the two folders (stage only those paths);
never git push; no new runtime deps in either repo; do not modify spec.md,
spec-streaming.md, or the docs-spec except for an internal contradiction (quote it
in DECISIONS.md). Schema stays v=1 — additive only.

When verify.sh first exits 0: run it twice more; run `make demo` once and watch the
live pane critically; update PROGRESS.md with the final summary (12/12 score,
commits, residual risks — especially "parser validated against docs, not against a
live claude run" if applicable, and the recommendation to watch one real
`studio run --watch` session). Then stop.
