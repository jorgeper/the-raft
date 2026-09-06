# Goal prompt for /goal — Copilot runtime + native goal engine

Run from the repo root: `/goal "$(sed '1,/^---$/d' goal-runtimes.md)"`

---

Extend the Black Sun harness in this repo with (1) a GitHub Copilot CLI runtime
and (2) a configurable coder loop engine, working only inside this repo.

**GOAL (the only exit condition):** `./scripts/verify.sh` stays 13/13,
`./scripts/verify-improve.sh` stays 12/12, and the new tests below are green
under `.venv/bin/python -m pytest -q` with `ruff check .` clean. Do not weaken
any existing check.

**What to build:**

1. **Copilot runtime** (`blacksun/runtime/copilot.py`): kind `copilot`,
   headless `copilot -p "<prompt>"` plus configurable extra flags (the config
   example ships `--allow-all-tools`). No native subagents: the registry's
   existing non-claude path inlines role prompt + skills. `available()` =
   binary on PATH. Accepted by config validation alongside claude/codex.
2. **Coder loop engine** (`loop.engine: python | goal`, default `python`):
   - `python` — the built-in GoalLoop, unchanged; `loop.gates` (new, optional)
     merge into the Goal as standing harness gates.
   - `goal` — one invocation of Claude Code's NATIVE /goal command: the
     orchestrator prefixes the statement in `prompts/goal-coder.md` with
     `/goal ` and sends it through the claude runtime, then THE HARNESS runs
     `loop.gates` itself in the worktree: all green -> pr:agent-review, any
     failure or NEEDS_HUMAN -> needs-human. The model's word still moves nothing.
   - Config fails loudly at load when engine `goal` is combined with a
     non-claude runtime (Copilot/Codex have no /goal), when `loop.gates` is
     empty (the harness would have nothing to verify with), or when
     `prompts/goal-coder.md` is missing.
3. **Docs:** README sections for the three runtimes (incl. Copilot CLI install/
   auth) and the engine choice; commented examples in `config/blacksun.yaml`;
   a DECISIONS.md line per judgment call.

**Tests (write first):** `tests/test_copilot.py` — factory, argv shape, failure
output, availability, config acceptance, skills inlined + no subagent file for
copilot agents. `tests/test_goal_engine.py` — config parsing + all three
loud-failure cases; dispatch sends a `/goal `-prefixed prompt; green gates ->
pr:agent-review; failing gate -> needs-human; NEEDS_HUMAN -> needs-human;
python engine still passes `loop.gates` into the Goal.

**Hard boundaries:** never touch `prompts/*.md` role prompts' NEVER sections,
never `git push`, runtime deps stay stdlib + PyYAML.
