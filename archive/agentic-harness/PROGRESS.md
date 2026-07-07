# Build progress — Agent Studio

Resume protocol: read this file + `git log --oneline -20` + spec.md §15/§17. The verify
score must never decrease.

## Current

- **Milestone:** M5 done → starting M6 (agents: prompts, skills, registry tests)
- **verify.sh score:** 3/13 at last full run (M1); expect ~7 now — rerun after M6
- **Tests:** 79 passing, lint clean

## Done

- M1 skeleton: pyproject, Makefile, .venv (uv, py3.12), state machine, config
  loader/validation, CLI skeleton, default markdown config, 13-check verify.sh.
- M2 trackers: MarkdownTracker (frontmatter items + board.md, O_EXCL claim locks),
  GitHubIssuesTracker (labels = states, via injected CommandExecutor), 18 tests.
- M3 runtimes: ClaudeCodeRuntime (`claude -p --agent studio-<name>`), CodexRuntime
  (`codex exec`), FakeRuntime (scripted), factory by `kind`.
- M4 GoalLoop: plan.json priority queue w/ canonical copy (passes is HARNESS-owned —
  reconcile ignores agent flips entirely), planning iteration, per-iteration gate
  re-verification, feedback injection, guardrails auto-append (3 same errors),
  test-count ratchet, no-diff/same-error circuit breaker, wall/iteration budgets,
  distinct exit reasons/codes, 16 tests incl. test_lying_agent_does_not_complete.
- M5 orchestrator: snapshot-per-tick dispatch (an item moves at most once per tick),
  claim/release, commenter dispatch (prd/architect), coder dispatch (worktree +
  GoalLoop, verified→pr:agent-review, else needs-human), review round (verdict
  parsing, missing verdict = CHANGES, degraded-review path), .agent-logs; CLI fully
  wired (init/new/approve/run/status), 17 tests.

## Next

- M6: real prompts (Role/Output contract/NEVER/Stop rule/Memory sections), five real
  SKILL.md files, registry tests (subagent generation + codex inlining + unknown-skill
  error), tests/test_skills.py (frontmatter validation, needed by verify check 9).
- M7: demo.sh + test_e2e_lifecycle.py.

## Gotchas

- `pyproject addopts = "-q"`: passing another `-q` to pytest hides the "N passed"
  summary; verify.sh relies on that line — don't double up.
- `python3` on PATH belongs to another project's venv; ALWAYS use `.venv/bin/python`.
- Checks 2/3 currently fail only on coverage (cli.py) and test count — they'll clear as
  milestones land; no action needed now.
