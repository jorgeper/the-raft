# Architecture

Four swappable abstractions, one plain-code orchestrator, one goal loop. No LLM
framework anywhere — when it goes sideways at 2am, it's code you can read.

## The abstractions

| Abstraction | Contract | Implementations |
|---|---|---|
| `Tracker` (studio/tracker/) | create / get / list / comment / transition / claim / release | `MarkdownTracker` (.work/ files + board.md), `GitHubIssuesTracker` (labels via `gh`) |
| `ModelRuntime` (studio/runtime/) | run(prompt, cwd, agent) → RuntimeResult; available() | `ClaudeCodeRuntime` (`claude -p --agent`), `CodexRuntime` (`codex exec`), `FakeRuntime` (scripted) |
| `AgentConfig` + `AgentRegistry` (studio/agents/) | declarative bundle → prompts + native subagent files | config/studio.yaml + prompts/ + .claude/skills/ |
| `GoalLoop` (studio/loop.py) | run(prompt, workdir, goal) → LoopResult | the one and only |

Every subprocess (`git`, `gh`, `claude`, `codex`, gate commands) goes through a single
injected `CommandExecutor` (studio/execution.py), so all of it is fakeable in tests.

## The state machine (studio/state.py)

```
backlog -> prd:drafting -> prd:review => prd:approved
        -> design:drafting -> design:review => design:approved -> ready
        -> coding -> pr:agent-review -> pr:changes-requested -> coding (loop)
                  -> pr:agent-review -> pr:human-review => done
any state -> needs-human (escalation; human-only exit)
```

`=>` edges are human-only; `pr:agent-review -> pr:human-review` fires only when every
reviewer verdict is APPROVE. The transition table is data with an actor class per edge,
and `check_transition` raises on wrong actors — the human gates are enforced in code,
not in prompts. Bugs (`kind: bug`) may go `backlog -> design:drafting` directly.

## The orchestrator (studio/orchestrator.py)

One tick: snapshot items per handled state → for each, claim → dispatch → transition →
persist under `runs/<stamp>-<item>-<agent>/` → release. An item moves at most once per
tick. Human-gated states are never dispatched — `studio status` surfaces them instead.
Concurrency is bounded by `max_concurrent_agents`; every tick appends one line to
`.agent-logs/orchestrator.log`.

Dispatch shapes:

- **Commenter** (prd, architect): one fresh invocation → one comment → state advances.
  Empty/failed output leaves the state untouched for retry next tick.
- **Coder**: worktree at `../.studio-worktrees/<item>` on `agent/<id>-<slug>`, then the
  GoalLoop. `verified` → pr:agent-review; anything else → needs-human with a report.
  The coder also picks up `pr:changes-requested`.
- **Review round**: every available reviewer runs, comments, and emits a
  `VERDICT: APPROVE|CHANGES` line (a missing verdict counts as CHANGES). All approve →
  pr:human-review; else pr:changes-requested. If only one reviewer runtime is
  installed, the round proceeds degraded (config: `allow_degraded_review`) and says so
  in a comment.

## The GoalLoop (studio/loop.py) — spec §6

The defining property: **the harness owns completion.** Per iteration:

1. Fresh prompt = role + orientation ritual + plan + progress tail + injected
   "why the previous iteration did not complete" + guardrails (last words win).
2. The agent works ONE task (highest-priority `passes: false`).
3. The harness re-runs the task's acceptance command and all standing gates itself.
   `passes` is harness-owned: the plan is reconciled from a canonical copy that the
   agent cannot edit (only `notes` survives from the agent's side); tasks get promoted
   only on the harness's own green run.
4. Failure output (last 50 lines) becomes the next iteration's feedback. Three
   identical failures auto-append a guardrail (Trigger/Instruction/Reason/Provenance).
5. Stop rules, OR-combined: max_iterations / max_minutes → `budget-exhausted`; 3
   no-diff or 5 same-error iterations → `thrash`; `NEEDS_HUMAN:` → `escalated`.
   Exit codes: 0 verified, 1 budget, 2 thrash, 3 escalated.

Extra teeth: test functions are counted every gate run and a drop fails the gate
(tests are a ratchet); verification requires a clean `git status`; `EXIT_SIGNAL:
COMPLETE` is required but never sufficient. Provenance for each mechanism:
[research/loop-engineering-research.md](../research/loop-engineering-research.md) §4.

## Skills and agent bundles

An agent = prompt + skills + tools + memory + runtime (+ optional mcp/hooks
passthrough). Skills are agentskills.io-standard directories under `.claude/skills/`.
Delivery depends on runtime:

- **claude**: `studio init` generates `.claude/agents/studio-<name>.md` with native
  `skills:` preloading; invocation is `claude -p "<task context>" --agent studio-<name>`.
- **codex** (or anything else): SKILL.md bodies are inlined into the prompt.

## Extending

- **New tracker** (Linear, ADO): subclass `Tracker`, add a branch in
  `studio/tracker/__init__.py:make_tracker`, map states to whatever the backend calls
  them. The state machine stays untouched.
- **New runtime**: subclass `ModelRuntime`, register in `studio/runtime/__init__._KINDS`,
  set `kind:` in config.
- **New agent**: a prompt file + a config entry (`handles: <state>`); give it a `loop:`
  block if it should run inside a GoalLoop.
- **New skill**: `.claude/skills/<name>/SKILL.md` with `name` matching the directory
  and a tight, boring `description`; list it in the agent's `skills:`.

## Safety model

Three layers (field guide §3): prompts advise (AGENTS.md), the harness enforces
in-process (.claude/settings.json allow/deny + guard.sh PreToolUse hook — exit 2
blocks pushes to main, merges, force pushes), the environment enforces out-of-process
(run it in a container/VPS with nothing to steal — deploy/vps.md). audit.sh writes a
JSONL trail of every tool call to .agent-logs/. Agents never merge; humans keep spec
approval and merge authority by construction.
