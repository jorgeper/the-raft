# Lab 2 — Add a feature

Goal: add due dates to the todo API from Lab 1. Same pipeline, now against an existing
codebase — which is where the architect grounding designs in real files, and the memory
journals, start paying off. Time: ~20 minutes of yours.

## 1. File it

```sh
python -m studio new "Due dates on todos" --body "Todos can carry an optional
due date. Overdue todos are queryable. Existing todos keep working (no
migration pain for API clients)."
python -m studio run --watch    # if it isn't already running
```

## 2. Gate one: the PRD, with feedback this time

Read the PRD (`gh issue view 2 --comments`). Deliberately push back at least once —
it's how you learn the revision loop and how the agent learns your taste:

```sh
gh issue comment 2 --body "R2: ISO-8601 dates only, reject anything else with a 400.
R4 (timezone handling) is out of scope for v1 — cut it."
```

The PRD agent's next pass must address both points explicitly. Check its journal
afterwards — `memory/prd/journal.md` should be accumulating your preferences:

```sh
python -m studio approve 2
```

## 3. The design against real code

The architect reads the Lab-1 codebase before designing: expect exact file paths
(`app/models.py`, `tests/test_todos.py`) and acceptance criteria that extend the
existing gates, e.g.:

```
- `curl -sf -X POST :8000/todos -d '{"title":"x","due":"2026-13-99"}' ... | grep -q 400` — R2
- `python -m pytest -q` — the whole suite still green (regression gate)
```

A design that says "modify the relevant files" instead of naming them is worth a
rejection comment. When it's concrete: `python -m studio approve 2`.

## 4. Watch the loop respect existing work

The interesting part of a brownfield task: the test-count ratchet means the coder
can't delete Lab-1 tests to make room, and the standing `python -m pytest -q` gate
means the old suite must stay green on every iteration. Check the progress log to see
the loop orienting against existing code before writing anything:

```sh
tail -f ../.studio-worktrees/2/.loop/progress.md
```

## 5. Review, merge, retrospect

Same as Lab 1: reviewers first (any CHANGES loops back without you), then your read
and merge at `pr:human-review`. Afterwards, do the two-minute retrospective that keeps
the system improving:

```sh
cat memory/coder/journal.md      # what did the coder learn about this codebase?
cat memory/reviewer/journal.md   # any recurring findings? consider promoting one
                                 # to AGENTS.md via an issue comment
```

## What you learned

- Brownfield changes ride the same pipeline; the difference is the architect
  grounding the design in real files — reject designs that don't name them.
- Pushing back on a PRD is a feature of the system, not friction: revision rounds
  must address your points one by one, and the journals learn your taste.
- The test-count ratchet and the standing full-suite gate protect existing work
  from the new feature on every single iteration.
- Agent journals are your window into what the team believes about the codebase —
  the weekly read is where compounding starts.

---

[← Lab 1: Build an app](01-build-an-app.md) · [Index](../README.md) ·
[Lab 3: Fix a bug →](03-fix-a-bug.md)
