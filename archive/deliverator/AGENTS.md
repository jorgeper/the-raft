# AGENTS.md — project conventions (read me first)

<!-- This is the always-on memory layer every agent reads at session start.
     Keep it TINY: only what an agent would otherwise get wrong. Anything
     conditional belongs in a skill (.claude/skills/). Edit the sections
     below to match YOUR project's stack. -->

## Stack
Python 3.11, Flask.  <!-- ← replace with your stack -->

## Commands (the inner loop — run before any PR)
- Install: `make install`
- Test:    `make test`   (every feature/bugfix needs a test)
- Lint:    `make lint`

<!-- The orchestrator, skills, and CI all assume these three make targets
     exist. Keep the targets; change what they do for your stack. -->

## Conventions
- Type hints on public functions. Keep changes small and scoped to the issue.

## Security / do-not-touch
- Secrets ONLY via env vars. Never commit secrets. Never touch `.env`.
