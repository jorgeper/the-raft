# Goal prompt for /goal — observability + console build

Run from the sandbox root: `/goal "$(sed '1,/^---$/d' big-board/goal.md)"`

---
Build the two-part system specified in
`/Users/jorgeper/src/sandbox/big-board/spec.md`: Part A adds an observability
contract to `/Users/jorgeper/src/sandbox/black-sun/` (event stream + JSON
snapshot commands + contract doc); Part B builds the Textual/Rich terminal app in
`/Users/jorgeper/src/sandbox/big-board/`. Work only inside those two folders.

GOAL (the only exit condition): `big-board/scripts/verify.sh` exits 0,
implementing exactly the 9 acceptance criteria in spec.md §8 — which include
black-sun's own verify.sh (13/13) and verify-docs.sh staying green. Do not
weaken any verify script; strengthening is allowed. Do not stop before it's green.

Read first, once: big-board/spec.md end to end; black-sun/spec.md §3–§6 and
the source you'll instrument (blacksun/orchestrator.py, blacksun/loop.py,
blacksun/tracker/, blacksun/cli.py, blacksun/demo.py); black-sun/docs/README.md and
one architecture chapter for the book's format; Textual + Rich docs via context7 if
needed for API specifics — no other web use.

How to work — hill-climb:
1. Write big-board/scripts/verify.sh FIRST from §8. Record the failing-check
   count in PROGRESS.md (this folder); it must only ever decrease.
2. Milestones O1→O2→C1→C2→C3→C4→C5 from spec §6, one commit each
   (`feat(obs): O<n> ...` / `feat(console): C<n> ...`). TDD inside each.
3. Part A discipline: EventLog is constructor-injected with a Null default;
   existing black-sun tests must stay green untouched (emission is additive).
   Regenerate the console fixtures from a REAL `blacksun demo --keep` run — never
   hand-author them.
4. Console discipline: never import `blacksun.` (verify.sh checks); all subprocess
   calls through one injected seam; unknown event kinds must render, not crash.
   Textual pilot tests run headless — no TTY assumptions anywhere in tests.
5. Self-review each screen as a stranger with `--replay` before its commit: is the
   dashboard readable at a glance? does every keybinding in the footer work? Fix
   what jars, then commit.
6. Record judgment calls in big-board/DECISIONS.md, one line each. Never block
   on a human. Both repos' PROGRESS notes live in big-board/PROGRESS.md.

Verification discipline: claims need evidence — run the thing. The integration
check (§8.4) must use a freshly produced demo event stream, not the fixture. When
verify.sh fails, read the actual output before changing anything.

Stop rules: same failing check 10 consecutive attempts with no measurable progress
→ BLOCKED report in PROGRESS.md, commit, stop. Missing prerequisite you cannot
install with uv into the console's own .venv → same.

Hard boundaries: touch nothing outside black-sun/ and big-board/ (repo root
is sandbox/; stage only those two paths). Never git push. Console runtime deps:
textual, rich, pyyaml only; black-sun runtime deps unchanged (stdlib + PyYAML —
events.py is stdlib). Do not modify either spec.md except to fix an internal
contradiction (quote it in DECISIONS.md). Do not break the observability contract
after O2 — the console builds against it, not around it.

When verify.sh first exits 0: run it twice more back-to-back; run `make demo` in
big-board and watch the full replay once critically; re-read both READMEs as a
stranger; commit `feat(console): C5 verify green`; write the final summary in
PROGRESS.md (score 9/9, commits, known limitations, the three things a human should
check by hand — the live dashboard against a real run, the contract doc's accuracy,
terminal compatibility). Then stop.
