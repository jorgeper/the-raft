# Going live on GitHub

*Moving from the markdown sandbox to a real repo: labels, credentials, the first
real item, and the checkpoints where you should stop and watch.*

## Before you start

Run the ladder in order — each step proves the next one's assumptions:

1. `make verify` green (the harness works on this machine).
2. `make demo` read end to end (you know what normal looks like).
3. [Lab 1](../labs/01-build-an-app.md) recommended as your first live run — it's
   this guide with training wheels and expected outputs.

## 1. Credentials

```sh
gh auth status          # GitHub CLI authenticated
claude --version        # Claude Code authenticated (run `claude` once interactively)
codex --version         # optional; without it reviews run degraded (visibly)
```

The agents inherit *your* `gh` auth locally. That's fine at level-2 autonomy where
you watch every dispatch; for anything unattended, mint a fine-grained PAT scoped to
the one repo — the [VPS guide](../../deploy/vps.md) covers the locked-down shape,
and [concepts/02](../concepts/02-anatomy-of-a-harness.md) explains why the token is
the enforcement layer that matters most.

## 2. Labels: the state machine, materialized

```sh
scripts/setup-github.sh you/your-app
```

Creates all fourteen `studio:*` state labels plus the three `kind:*` labels,
idempotently (`--force`). Color language: **red labels need you** (`prd:review`,
`design:review`, `pr:human-review`, `needs-human`), blue/purple are agent lanes,
green are approved/terminal. Your issues list filtered to red labels is your inbox —
the same view `studio status` gives you.

## 3. Point the studio at the repo

```yaml
# config/studio.yaml
tracker: {kind: github, repo: you/your-app}
target_repo: ../your-app        # a local clone; worktrees are cut from it
```

```sh
python -m studio init           # validates, regenerates subagents, checks runtimes
```

`target_repo` needs a clean local clone with `main` checked out. Agents work in
worktrees beside it (`../.studio-worktrees/<item>`) and push only `agent/*` branches
— the guard hook and permissions make main-pushes and merges structurally
impossible ([the stack](../architecture/06-orchestrator-and-safety.md)).

## 4. The first real item

```sh
python -m studio new "Health endpoint" --body "GET /health returns 200 {\"ok\": true}.
Tiny on purpose: this item exists to shake down the pipeline."
python -m studio run --once     # tick by hand the first time
gh issue view 1 --comments      # read the PRD it produced
python -m studio approve 1      # gate 1
python -m studio run --once     # architect
gh issue view 1 --comments      # read the design — acceptance criteria especially
python -m studio approve 1      # gate 2
python -m studio run --once     # the GoalLoop: this tick will take minutes, not seconds
```

Deliberately tiny first item: you're testing the *pipeline*, not the product.
While the coder runs, watch it live:

```sh
tail -f ../.studio-worktrees/1/.loop/progress.md
```

Then reviews (`--once` again), then your merge at `pr:human-review`:

```sh
gh pr view 1 --comments && gh pr diff 1
gh pr ready 1 && gh pr merge 1 --squash
python -m studio approve 1
```

## 5. Only then: loosen your grip

Swap `--once` for `--watch` when hand-ticking feels redundant, not before. The
checkpoints on the [trust ladder](../concepts/05-autonomy-and-safety.md): the
reviewers' comments match ones you'd write; a `needs-human` escalation arrived and
its report told you everything; you disagreed with an agent at least once and tuned
a prompt or skill in response. 24/7 operation is the same system with a stricter
environment — [deploy/vps.md](../../deploy/vps.md) when you're ready.

## Odds and ends that bite

- **One state label per issue.** If a human hand-edits labels and leaves two
  `studio:*` labels, the tracker reads the first it finds — fix by removing the
  stale one.
- **Comment authorship** is recovered from the `**[agent]**` prefix the studio
  writes; your own plain comments show as you, which is exactly what agents expect
  when reading feedback.
- **Claims are labels** (`claimed-by:<agent>`). A crashed run can leave one behind;
  `gh issue edit N --remove-label claimed-by-coder` frees it (see
  [troubleshooting](05-troubleshooting.md)).

---

[← Configuration](03-configuration.md) · [Index](../README.md) ·
[Troubleshooting →](05-troubleshooting.md)
