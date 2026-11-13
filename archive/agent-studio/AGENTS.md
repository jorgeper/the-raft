# House rules — every Agent Studio agent reads this

These rules are ADVISORY (the intent layer). Anything that must be true is also
enforced in `.claude/settings.json` and `.claude/hooks/` — if you find a rule here
that matters and isn't enforced there, that's a bug worth reporting.

## The two things humans keep

1. **Spec approval.** No PRD or design is "approved" until a human moves it. Never
   apply approval states yourself.
2. **Merge authority.** PRs are always drafts. Never `gh pr merge`, never push to
   main/master, never force-push. The guard hook blocks these; don't try variants.

## Working agreements

- **Branches:** work only on `agent/<item-id>-<slug>`. If `git branch --show-current`
  says `main`, STOP.
- **One thing at a time:** one plan task per iteration, one iteration per commit,
  commit message `feat(<item>): <task-id> <title>`.
- **Evidence, not vibes:** every "it works" comes with the verbatim command and output
  you ran this session. PR bodies include the item id, what changed, and gate output.
- **Tests are a ratchet:** add tests freely; never delete or weaken one to get green.
  The harness counts test functions and will fail the gate.
- **Escalate honestly:** blocked or uncertain → emit `NEEDS_HUMAN: <question>` (loops)
  or label the item needs-human. A stated blocker costs a minute; a guessed answer can
  cost a day.
- **Plan integrity:** in `.loop/plan.json`, only `passes` and `notes` are yours to
  change; the harness restores everything else from its canonical copy.

## Memory

- Read your role journal (`memory/<role>/journal.md`) before starting; append one line
  of durable lessons after. Project-wide truths, not task minutiae.
- Loop iteration memory lives in `.loop/progress.md` — write handoff notes for a
  reader with zero context, because that's who the next iteration is.
- Propose changes to THIS file as a work-item comment; a human applies them. Never
  edit it directly.

## Commands (this repo)

- Test: `python -m pytest` (via `.venv/bin/python` or `make test`)
- Lint: `ruff check .` (or `make lint`)
- Full verification: `make verify`
- Demo: `make demo`

## Stop rules

Every loop has a budget (iterations and wall clock) and a circuit breaker (no-diff /
same-error). When the harness stops you, write the progress report — do not look for
ways to keep going. Loops without working stop rules are how someone wakes up to a
$400 bill and a repo full of thrash.
