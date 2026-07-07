# Lab 1 — Build an app from zero

Goal: go from an empty repo to a working Flask todo API, entirely through the studio
pipeline, touching the work only at your two gates. Time: ~45 minutes, mostly waiting
on loops while you drink coffee.

## 0. Prerequisites

```sh
claude --version        # Claude Code CLI, authenticated
gh auth status          # GitHub CLI, authenticated
codex --version         # optional — reviewer-b degrades gracefully without it
```

Run `make demo` once first: it exercises the whole machine offline so you can tell
"studio problem" from "my setup problem" later.

## 1. Create the app repo and wire the studio to it

```sh
gh repo create todo-api --private --clone
cd todo-api && git commit --allow-empty -m "root" && git push -u origin main
cd ../agent-studio
scripts/setup-github.sh you/todo-api
```

Edit `config/studio.yaml`:

```yaml
tracker: {kind: github, repo: you/todo-api}
target_repo: ../todo-api
```

Then validate and generate the native subagents:

```sh
python -m studio init
```

## 2. File the founding feature request (you, 2 minutes)

```sh
python -m studio new "Todo API v1" --body "A small HTTP API to create, list,
complete and delete todos. Python. No auth in v1. Must be runnable locally
with one command."
```

## 3. Let the pipeline run

```sh
python -m studio run --watch
```

Watch the first tick dispatch the **prd** agent. When `studio status` shows the item in
`prd:review`:

## 4. Gate one: review the PRD (you)

```sh
gh issue view 1 --comments      # read the PRD like you mean it
```

Disagree with something? Comment on the issue (`gh issue comment 1 --body "R3 is
overkill for v1 — drop pagination"`), then move it back:
the PRD agent will revise, addressing your points one by one. Satisfied?

```sh
python -m studio approve 1      # prd:review -> design:drafting
```

The **architect** now produces a design spec whose acceptance criteria are literal
shell commands — that section is what the coder's GoalLoop will enforce, so read it
hardest. Iterate the same way, then:

```sh
python -m studio approve 1      # design:review -> ready
```

## 5. The coder loop (nobody, that's the point)

The orchestrator claims the item, cuts a worktree on `agent/1-todo-api-v1`, and the
GoalLoop starts: a planning iteration writes `.loop/plan.json`, then one task per
iteration — test first, implement, the harness re-runs the gates after every pass.
Follow along if you like:

```sh
tail -f ../.studio-worktrees/1/.loop/progress.md
```

If the loop exhausts its budget or thrashes, the item lands in `needs-human` with a
progress report as a comment — read it, fix the blocker (usually a vague criterion),
and re-route.

## 6. Agent review, then gate two: your merge

When the draft PR opens, both reviewers run the gates themselves and post evidence
with a `VERDICT:` line. CHANGES send it back to the coder automatically; you do
nothing. When `studio status` says `pr:human-review`:

```sh
gh pr view 1 --comments   # read the full agent conversation — this is the anti-
gh pr diff 1              # cognitive-surrender rep; don't skip it
gh pr ready 1 && gh pr merge 1 --squash
python -m studio approve 1      # records done in the tracker
```

## 7. What you just did

Two approvals and one merge. The team wrote the PRD, the design, the code, the tests,
ran the app, reviewed it twice, and iterated on its own rejections. Next:
[Lab 2 — add a feature](02-add-a-feature.md).
