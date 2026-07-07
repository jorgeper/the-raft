---
name: acceptance-criteria
description: Turn requirements into machine-runnable acceptance criteria (command + expected result). Use when writing a design spec's acceptance section.
---

# Acceptance criteria the harness can run

The coder's GoalLoop converts your acceptance criteria directly into `plan.json` tasks
and gates. A criterion is therefore a **shell command that exits 0 on success** — plus
one line saying what it proves.

## Form

```
- `python -m pytest tests/test_todos.py -q` — unit coverage for R1–R4
- `sh -c 'curl -sf -X POST localhost:8000/todos -d "{\"title\":\"x\"}" -H "Content-Type: application/json" | jq -e ".id"'` — R2: create returns the new id
- `sh -c 'curl -s -o /dev/null -w "%{http_code}" localhost:8000/todos -X POST -d "{}" -H "Content-Type: application/json" | grep -q 400'` — R3: missing title rejected
```

Rules:

- Exit code is the verdict. Pipe to `grep -q`, `jq -e`, `test` — never rely on a human
  reading the output.
- Each criterion checks ONE requirement and references its number.
- Include setup in the command when needed (fresh db, server running); if a criterion
  needs a live server, say how it starts, and prefer a script the repo already has.
- Always include the standing gates as criteria too: the repo's test command and lint
  command. The GoalLoop runs them after every iteration.

## Traps

- A criterion that passes on an empty implementation (`grep -q ""`). Try to make each
  one fail first in your head: what wrong implementation would still pass it?
- Timing-dependent checks (sleep-based races) — flaky gates poison the loop with
  false feedback.
- Criteria that depend on network or credentials — the loop runs offline; if it needs
  the internet, it needs a human, so put it in the test plan for manual verification.
- Vague verbs. "Verify the UI looks right" is not a criterion; screenshot diffing or a
  DOM assertion is.
