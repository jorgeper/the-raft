# Decisions — judgment calls the spec left open

- Dedicated `.venv` created with uv inside agent-studio; Makefile/verify.sh use it via
  `PYTHON` env override — the system `python3` points at an unrelated venv.
- Prompt files and SKILL.md files created as stubs in M1 so `config/studio.yaml`
  validates from the first commit; real content lands in M6 (spec's milestone for them).
- State machine: `prd:review → prd:drafting` and `design:review → design:drafting` added
  as human-only edges — the spec's "human comments/iterates" loop needs an explicit
  request-changes transition.
- `studio approve` performs the two-step advance (e.g. prd:review→approved→design:drafting)
  as two validated transitions; `prd:approved→design:drafting` is human+orchestrator.
- Actor model has three classes (human/agent/orchestrator); orchestrator-only edges are
  the reviewer-verdict promotions, per spec §4.
- Escalation `* → needs-human` allowed for every actor from every non-terminal state;
  `needs-human → *` is human-only ("terminal until a human re-routes").
- verify.sh check 11 ("fresh clone") implemented as tar-copy excluding .venv/.git with
  PYTHON pointing at the existing venv — hermetic enough without re-installing deps.
- demo.sh honors `$PYTHON` (falls back to `.venv/bin/python`) so Makefile and verify.sh
  can both drive it.
- The subprocess seam is `studio/execution.py` (not `exec.py` — stdlib-shadowing name).
- Runtime configs carry a `kind` (claude|codex) defaulting to the runtime's name, so
  users can define e.g. `reviewer-model: {cmd: codex, kind: codex}`.
- GoalLoop `passes` flags are fully HARNESS-owned: reconcile restores them from the
  canonical copy and only the harness's own green gate run promotes a task. The agent
  flipping flags is tolerated but has no effect (stronger than "revert lying flips").
- The harness promotes a task once its acceptance command + gates pass, even if the
  agent forgot to flip it — spirit of spec §6, saves an iteration.
- Orchestrator ticks snapshot items first: an item transitions at most once per tick
  (otherwise coder → review happened in one tick with empty reviewer scripts).
- Coder agents also handle `pr:changes-requested` (registered automatically for any
  agent with a `loop:` block) — the spec's review loop needs it.
- Orchestrator applies agent-outcome transitions with Actor.AGENT on the agent's
  behalf; verdict promotions/demotions use Actor.ORCHESTRATOR per spec §4.
- Tracker ABC gained `release()` (not in spec's sketch) — claims must be droppable
  after a dispatch or items would stay locked forever.
- Reviewer memory dirs merge to `memory/reviewer/` via an AgentConfig.memory field.
- E2E asserts runs/, comments, states, and .loop/progress.md; per-role memory-journal
  writes are real-agent behavior that scripted fakes can't produce.
- GitHub claim() is read-then-write (label-based) — racy across multiple orchestrators;
  documented as a v1 single-orchestrator assumption.
- verify.sh check 9's >40-line rule is satisfied by making the hooks genuinely richer
  (blocked.log, rm -rf guard, log rotation, input-schema docs), not by padding.
- Docs build: verify-docs.sh check 7 required 'What you learned' in ALL labs while §2 said old labs get only link updates — resolved in favor of §6.7 (sections added to labs 1-3).
- guard.sh push-to-main pattern extended to refspec form (HEAD:main) during the docs stranger-pass — concepts/02 claimed semantic matching, so the hook was strengthened to match the claim.

## Self-improve build (goal-self-improve.md)

- Shipped config keeps the top-level `agents:` block as the implicit `classic` set coexisting with `agent_sets:` — required because pre-existing test_config.py mutates `raw["agents"]` and must pass unmodified (spec R2 beats a pure agent_sets layout for R4).
- Only the ACTIVE agent set is validated at load; a broken inactive set fails on the day you switch. (Original plan validated all sets; test_config's scaffold only writes active-set prompt files.)
- Scorecard snapshots are appended by the orchestrator tick (scanning done items), not by the CLI approve path — the tick is the one place guaranteed to run in every deployment mode.
- Coder lessons are harvested via a GoalLoop.output_hook fed each iteration's raw output — the loop stays item-agnostic.
- Revert diffs are `git diff <sha> <sha>^`; R25 is tested as tree-equality against a real `git revert` on a clone.
- A rejected revert proposal marks the original improvement `kept` (the human chose to accept the regression); an applied one marks it `reverted`.
- Improvement trigger counts only non-improvement snapshots of the active set; consumed ids are tracked via `filed` records in memory/improvements.jsonl.
- verify-improve.sh check 9 greps the revert-equality test in test_regression_guard.py (where it lives), not test_improve_apply.py as §11.9's shorthand implied.
- Spec §10 Q1: reviewer journals stay shared (`memory/reviewer/`) in the evolving set. Q2: scorecard snapshots record the set active at `done`.
