# Agent Studio

A harness for building apps with a team of AI agents — a PRD writer, an architect, a
coder that hill-climbs inside a Ralph-style goal loop, and two code reviewers on
different models — orchestrated through a work-item state machine. You keep exactly two
powers, and they never get automated: **approving specs** and **merging code**.

The design is loop engineering, not prompt engineering: you don't prompt the agents,
you file work items. Agents discover their work by state, execute it, and the harness —
plain Python you can read — verifies every claim by running the gates itself. An agent
saying "done" moves nothing; a green gate does. (Background: the
[field guide](agentic-engineering-field-guide.md) and [research/](research/) this repo
was built from; the full contract is [spec.md](spec.md).)

Everything runs locally with Claude Code (and optionally Codex for the second
reviewer), tracks work in GitHub Issues or plain markdown files, and can run 24/7 on a
VPS ([deploy/vps.md](deploy/vps.md)).

## Architecture

```
        GitHub Issues / .work/*.md   <- the single work queue (labels = state machine)
                    |
              orchestrator (plain python, --watch)  ..  polls, claims, dispatches
                    |
   prd ---------> PRD comment          <- YOU approve (studio approve)
   architect ---> design spec comment  <- YOU approve (studio approve)
   coder -------> GoalLoop in a git worktree: plan.json -> build -> harness runs gates
                    |                    (fresh context per iteration, guardrails,
                    |                     circuit breaker, budgets — spec §6)
              draft PR
                    |
   reviewer-a (claude) + reviewer-b (codex) -> VERDICT lines, evidence required
                    |
        both APPROVE -> pr:human-review  <- YOU read the history and merge
```

## Quickstart (5 minutes, no API keys)

```sh
git clone <this-repo> && cd agent-studio
uv venv .venv && uv pip install --python .venv/bin/python pyyaml pytest pytest-cov ruff
make demo     # full lifecycle on a throwaway repo with scripted agents
make verify   # the 13-point acceptance checklist (spec §17)
source .venv/bin/activate   # so `python -m studio ...` below resolves here
```

The demo shows the whole loop: request → PRD → design → code → a rejected review →
the fix → approval → done, with every state printed.

## Going live

1. `gh auth login` and `claude` (Claude Code CLI) authenticated; optionally `codex`.
2. `scripts/setup-github.sh you/your-app` — creates the state labels.
3. Edit `config/studio.yaml`: `tracker: {kind: github, repo: you/your-app}` and point
   `target_repo:` at your app checkout.
4. `python -m studio init` — validates config, generates the native Claude Code
   subagent files, checks runtimes.
5. File work and run the loop:

```sh
python -m studio new "Add user login" --body "Users need accounts"
python -m studio run --watch      # or --once per tick, or --dry-run to preview
python -m studio status           # the board + what needs YOU
python -m studio approve 1        # your gate: PRD, then design, then merge
```

## Your two touchpoints

- `studio status` shows a "Needs you" list: PRDs and designs to approve, agent-approved
  PRs to merge, escalations to re-route. Everything else runs itself.
- Approval is meaningful only if you read the thing. The agents write, review, and
  test; deciding that the built thing is the *right* thing never delegates.

## Hands-on labs

1. [Build an app from zero](docs/labs/01-build-an-app.md)
2. [Add a feature](docs/labs/02-add-a-feature.md)
3. [Fix a bug](docs/labs/03-fix-a-bug.md)

## Learn more

- [docs/architecture.md](docs/architecture.md) — abstractions, the GoalLoop internals,
  how to add a tracker/runtime/agent/skill, the safety model.
- [AGENTS.md](AGENTS.md) — the house rules every agent reads.
- [deploy/vps.md](deploy/vps.md) — running 24/7 on a VPS with systemd.
