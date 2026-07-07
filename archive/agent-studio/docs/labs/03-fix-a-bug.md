# Lab 3 — Fix a bug

Goal: report a bug, get back a fix PR with a regression test, merge it. Bugs skip the
PRD stage (`backlog -> design:drafting` is legal for `kind: bug`), so this is the
short pipeline: one approval instead of two. Time: ~10 minutes of yours.

## 1. Report it like you'd want it reported

```sh
python -m studio new "Completing a deleted todo returns 500" --kind bug --body "
Repro:
  curl -X POST :8000/todos -d '{\"title\":\"x\"}'   # -> id 1
  curl -X DELETE :8000/todos/1
  curl -X POST :8000/todos/1/complete
Expected: 404 {\"error\": \"todo not found\"}
Actual:   500, KeyError traceback in the server log
"
```

A repro in the report becomes the regression test almost verbatim — the better your
repro, the less design iteration you'll need.

## 2. One gate: the fix design

The architect goes straight to work (no PRD for bugs) and should produce a half-page
design whose acceptance criteria include **the repro as a failing-then-passing check**
plus the full-suite regression gate:

```
- `sh -c 'curl -s -o /dev/null -w "%{http_code}" -X POST :8000/todos/99/complete | grep -q 404'`
- `python -m pytest -q`
```

If the design proposes a refactor while it's in there — push back; a bug fix design
that grows scope is how fixes take a week:

```sh
python -m studio approve 3      # design:review -> ready
```

## 3. The loop writes the regression test first

Watch `.loop/progress.md`: iteration one should show the new test failing with the
500 (red), the fix, then green. That order is the tdd-workflow skill doing its job —
a fix without a test that failed first is a fix you can't trust:

```sh
tail -f ../.studio-worktrees/3/.loop/progress.md
```

## 4. Review and merge

Reviewers run the repro themselves (their rubric demands evidence, not the coder's
word). At `pr:human-review`, your read is quick for a bug fix, but check two things:

1. The regression test actually encodes the repro from your report.
2. The diff is a fix, not a stealth refactor.

```sh
gh pr diff 3 && gh pr ready 3 && gh pr merge 3 --squash
python -m studio approve 3
```

## 5. Close the learning loop

The reviewer journal (`memory/reviewer/journal.md`) is where recurring bug classes
show up. When the same finding appears twice, promote it: comment a proposed house
rule on any open issue, and if you agree with yourself tomorrow, add it to AGENTS.md.
The system should be measurably harder to break each week you use it — that's the
whole game.
