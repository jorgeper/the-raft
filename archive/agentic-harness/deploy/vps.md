# Running Agent Studio 24/7 on a VPS

Continuous operation is a phase change (field guide §6): triggers replace prompts,
and safety must become architecture, because nobody is watching the terminal.

## Safety posture first (read before enabling anything)

A VPS running `--watch` is Konishi Pattern C territory: relaxed supervision is
defensible **only** when the environment enforces what prompts can't:

- A dedicated, non-root user (`studio`) that owns ONLY the studio and the target repo
  checkout. No personal dotfiles, no `~/.aws`, no SSH keys beyond a deploy key.
- A GitHub token scoped to the one target repo, with `repo` scope and nothing else
  (fine-grained PAT). The guard hook blocks merges/pushes-to-main in-process, but the
  token is your out-of-process backstop — give it nothing you'd miss.
- Egress-restricted if your provider supports it (Anthropic/OpenAI/GitHub endpoints).
- Budgets: keep `max_concurrent_agents` low (1–2) and loop budgets tight; the loop's
  stop rules are what stand between you and a surprise bill overnight.

## Install (Ubuntu 24.04)

```sh
adduser --system --group --home /opt/studio studio
sudo -u studio -H bash -lc '
  cd /opt/studio
  git clone <your-studio-fork> agentic-harness
  git clone git@github.com:you/your-app app        # deploy key, read-write
  cd agentic-harness
  curl -LsSf https://astral.sh/uv/install.sh | sh
  uv venv .venv && uv pip install --python .venv/bin/python pyyaml pytest pytest-cov ruff
  npm install -g @anthropic-ai/claude-code         # plus: gh, optionally codex
'
```

Authenticate as the `studio` user: `gh auth login` (the scoped PAT),
`claude` once interactively (or `ANTHROPIC_API_KEY` in the unit's env file),
`codex login` if you run the second reviewer.

Point `config/studio.yaml` at the repo and app path:

```yaml
tracker: {kind: github, repo: you/your-app}
target_repo: /opt/studio/app
poll_interval_s: 120
```

Validate before daemonizing — never automate what you haven't watched work:

```sh
sudo -u studio -H bash -lc 'cd /opt/studio/agentic-harness &&
  .venv/bin/python -m studio init &&
  .venv/bin/python -m studio run --once --dry-run'
```

## The systemd unit

```sh
cp deploy/agent-studio.service /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now agent-studio
```

Secrets go in `/opt/studio/agent-studio.env` (mode 600, owner studio):

```
ANTHROPIC_API_KEY=sk-ant-...
GH_TOKEN=github_pat_...
```

## Operating it

- **Logs:** `journalctl -u agent-studio -f` for the orchestrator;
  `.agent-logs/audit.jsonl` for every tool call an agent made;
  `runs/` for full prompts and outputs per dispatch.
- **Your inbox:** `studio status` over SSH, or just the GitHub issues list filtered by
  `studio:prd:review`, `studio:design:review`, `studio:pr:human-review`,
  `studio:needs-human` — those four labels are the only things that need you.
- **Health check:** the unit restarts on crash; a cron'd
  `python -m studio run --once --dry-run || alert` catches config rot.
- **Updating:** `systemctl stop agent-studio`, `git pull`, `make verify`,
  `systemctl start agent-studio`. Verify green before restart, every time.

## Trust ladder

Week 1: `poll_interval_s: 3600` and check every dispatch. Week 2: normal polling,
you read every PR fully. Only when the reviewers' comments have repeatedly matched
what you'd have said do you let the cadence be the system's. Start small, expand as
trust builds — autonomy is earned, not configured (field guide §4).
