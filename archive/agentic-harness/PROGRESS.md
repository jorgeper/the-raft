# Build progress — Agent Studio

Resume protocol: read this file + `git log --oneline -20` + spec.md §15/§17. The verify
score must never decrease.

## Current

- **Milestone:** M1 done → starting M2 (trackers)
- **verify.sh score:** 3/13 (1 ruff, 7 config-sanity, 8 actor-enforcement)
- **Tests:** 21 passing, lint clean

## Done

- M1 skeleton: pyproject, Makefile, .venv (uv, py3.12), .gitignore, state machine
  (`studio/state.py` + 12 tests), config loader/validation (`studio/config.py` + 9
  tests), CLI skeleton (init works; new/approve/run/status/demo stubbed), default
  markdown-tracker `config/studio.yaml`, stub prompts/skills/memory, full 13-check
  `scripts/verify.sh`.

## Next

- M2: MarkdownTracker + GitHubIssuesTracker + tests (needs a WorkItem model and the
  injected CommandExecutor seam for `gh`).

## Gotchas

- `pyproject addopts = "-q"`: passing another `-q` to pytest hides the "N passed"
  summary; verify.sh relies on that line — don't double up.
- `python3` on PATH belongs to another project's venv; ALWAYS use `.venv/bin/python`.
- Checks 2/3 currently fail only on coverage (cli.py) and test count — they'll clear as
  milestones land; no action needed now.
