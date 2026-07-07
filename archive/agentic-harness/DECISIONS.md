# Decisions — judgment calls the spec left open

- Dedicated `.venv` created with uv inside agentic-harness; Makefile/verify.sh use it via
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
