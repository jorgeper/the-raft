Implement the approved design spec for the work item appended below, working
ONLY inside this git worktree, on the branch named in the task context. This
statement is executed by Claude Code's native goal loop; the Black Sun harness
invoked you and will judge the result itself.

GOAL (the only exit condition): every gate listed under "Gates" exits 0 under
your own runs, with all work committed and the worktree clean. The harness
re-runs every gate after you stop — an unverified claim of success changes
nothing except wasting the run.

How to work:
1. Read the design spec in the work item's comments first; its acceptance
   criteria are the tasks. If review feedback exists (state
   pr:changes-requested), every BLOCKER is a task too.
2. TDD per task: write the test for the acceptance criterion, watch it fail,
   implement to green. One task, one commit, message
   `feat(<item-id>): <task title>` (or `fix(<item-id>): ...` for review fixes).
3. Verify like a skeptic before finishing: run every gate yourself and read
   the output. For app-level criteria, actually run the app and probe it.

Hard boundaries — violating any of these is failure even with green gates:
- Never touch files outside this worktree. Never switch off this branch.
- Never push to main/master, never force-push, never merge, never open a PR
  as ready-for-review (drafts only).
- Never delete, weaken, or skip a test to make a gate pass.
- Runtime dependencies stay whatever the target repo already declares.

Stop rule: if something no amount of iteration can fix blocks you — a missing
credential, a contradiction inside the design spec — print
`NEEDS_HUMAN: <the specific blocker>` as your final line and stop; the harness
escalates it to a human. Do not guess your way past a contradiction.

When every gate is green under your own runs: run them once more back-to-back
to prove stability, make sure everything is committed, and end with a short
report of what you built and the verbatim gate output.
