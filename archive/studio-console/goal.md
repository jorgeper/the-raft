# Goal prompt for /goal — observability + console build

Run from the sandbox root: `/goal "$(sed '1,/^---$/d' studio-console/goal.md)"`

---
Build the two-part system specified in
`/Users/jorgeper/src/sandbox/studio-console/spec.md`: Part A adds an observability
contract to `/Users/jorgeper/src/sandbox/agent-studio/` (event stream + JSON
snapshot commands + contract doc); Part B builds the Textual/Rich terminal app in
`/Users/jorgeper/src/sandbox/studio-console/`. Work only inside those two folders.

GOAL (the only exit condition): `studio-console/scripts/verify.sh` exits 0,
implementing exactly the 9 acceptance criteria in spec.md §8 — which include
agent-studio's own verify.sh (13/13) and verify-docs.sh staying green. Do not
weaken any verify script; strengthening is allowed. Do not stop before it's green.

Read first, once: studio-console/spec.md end to end; agent-studio/spec.md §3–§6 and
the source you'll instrument (studio/orchestrator.py, studio/loop.py,
studio/tracker/, studio/cli.py, studio/demo.py); agent-studio/docs/README.md and
one architecture chapter for the book's format; Textual + Rich docs via context7 if
needed for API specifics — no other web use.

How to work — hill-climb:
1. Write studio-console/scripts/verify.sh FIRST from §8. Record the failing-check
   count in PROGRESS.md (this folder); it must only ever decrease.
2. Milestones O1→O2→C1→C2→C3→C4→C5 from spec §6, one commit each
   (`feat(obs): O<n> ...` / `feat(console): C<n> ...`). TDD inside each.
3. Part A discipline: EventLog is constructor-injected with a Null default;
   existing agent-studio tests must stay green untouched (emission is additive).
   Regenerate the console fixtures from a REAL `studio demo --keep` run — never
   hand-author them.
4. Console discipline: never import `studio.` (verify.sh checks); all subprocess
   calls through one injected seam; unknown event kinds must render, not crash.
   Textual pilot tests run headless — no TTY assumptions anywhere in tests.
5. Self-review each screen as a stranger with `--replay` before its commit: is the
   dashboard readable at a glance? does every keybinding in the footer work? Fix
   what jars, then commit.
6. Record judgment calls in studio-console/DECISIONS.md, one line each. Never block
   on a human. Both repos' PROGRESS notes live in studio-console/PROGRESS.md.

Verification discipline: claims need evidence — run the thing. The integration
check (§8.4) must use a freshly produced demo event stream, not the fixture. When
verify.sh fails, read the actual output before changing anything.

Stop rules: same failing check 10 consecutive attempts with no measurable progress
→ BLOCKED report in PROGRESS.md, commit, stop. Missing prerequisite you cannot
install with uv into the console's own .venv → same.

Hard boundaries: touch nothing outside agent-studio/ and studio-console/ (repo root
is sandbox/; stage only those two paths). Never git push. Console runtime deps:
textual, rich, pyyaml only; agent-studio runtime deps unchanged (stdlib + PyYAML —
events.py is stdlib). Do not modify either spec.md except to fix an internal
contradiction (quote it in DECISIONS.md). Do not break the observability contract
after O2 — the console builds against it, not around it.

When verify.sh first exits 0: run it twice more back-to-back; run `make demo` in
studio-console and watch the full replay once critically; re-read both READMEs as a
stranger; commit `feat(console): C5 verify green`; write the final summary in
PROGRESS.md (score 9/9, commits, known limitations, the three things a human should
check by hand — the live dashboard against a real run, the contract doc's accuracy,
terminal compatibility). Then stop.
