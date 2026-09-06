---
name: tdd-workflow
description: Tests-first implementation discipline (red, green, commit). Use when implementing any plan task.
---

# TDD inside the GoalLoop

One iteration = one task = one commit. Inside that iteration the order is fixed:

## The cycle

1. **Red.** Write the test for the task's acceptance criterion first. Run it. Watch it
   fail — for the RIGHT reason (a missing feature, not an import typo). A test you
   never saw fail proves nothing.
2. **Green.** Write the smallest implementation that passes. Resist implementing the
   next task early; unplanned scope is how loops lose the thread.
3. **All green.** Run the full test suite and lint, not just your new test. You own
   any regression you introduced, this iteration.
4. **Commit.** `feat(<item>): <task-id> <title>`. Never batch two tasks in one commit.

## Test quality

- The test docstring says WHY: which requirement, what behavior — so a future agent
  (or reviewer) knows what breaks means.
- Test through the public surface (API route, CLI entry), not internals, unless the
  task is explicitly about an internal contract.
- Cover the unhappy path the criterion implies: the 400, the empty list, the missing
  file. One happy assert is half a test.
- Deterministic only: no sleeps, no network, no wall-clock assumptions. Fake time and
  IO at seams.

## Hard lines

- Never delete or weaken an existing test to get green — the harness counts test
  functions and will fail the gate anyway.
- Never mark the plan task passed on a partial run ("tests probably pass").
- If the acceptance criterion itself is untestable as written, that's a design defect:
  emit `NEEDS_HUMAN:` rather than quietly testing something easier.
