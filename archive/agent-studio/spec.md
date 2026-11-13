# Agent Studio — Specification

A harness for building apps with a team of AI agents, orchestrated through a work-item
state machine, with humans keeping exactly two powers: **approving specs** and **merging code**.

This spec is the contract for an autonomous build loop. Every requirement is written to be
machine-verifiable where possible. The finish line is §17 (Acceptance Criteria), checked by
`./scripts/verify.sh`. Design rationale comes from `agentic-engineering-field-guide.md` in
this directory — read it before building; its principles are normative:

- Makers never check their own work (maker/checker split).
- Objective gates (tests, lint, run-the-app) before subjective review.
- The work queue lives outside the agents (tracker = shared memory).
- Enforcement lives in harness + environment, never only in prompts.
- Every loop has a machine-verifiable finish line and an explicit stop rule.
- Everything persisted: runs, journals, decisions — resumable, diffable, greppable.
- Build the minimum harness that enforces each property — no mechanism without a failure
  mode it prevents; scaffolding gets deleted as models improve (Anthropic).

---

## 1. Overview

Agent Studio is a clonable repo scaffold. A user clones it next to (or into) their app
repo, configures a tracker (GitHub Issues by default), and gets a team of agents:

| Agent | Role | Loop? | Model |
|---|---|---|---|
| **prd** | Turns a feature request into a PRD; iterates on human comments | comment-iteration loop | Claude Code |
| **architect** | Turns an approved PRD into a technical design spec; iterates | comment-iteration loop | Claude Code |
| **coder** | Implements an approved design in a worktree via the GoalLoop (a sophisticated Ralph loop, §6); opens a draft PR | GoalLoop | Claude Code |
| **reviewer-a** | Reviews the PR against the spec with evidence; verdict APPROVE/CHANGES | review loop | Claude Code |
| **reviewer-b** | Same as reviewer-a, different model for independence | review loop | Codex CLI (OpenAI) |
| **orchestrator** | Plain code (no LLM). Polls tracker, matches state → agent, dispatches | poll loop | none |

Human touchpoints (never automated): approve PRD, approve design, final review + merge.

The whole lifecycle:

```
human files feature request
  → prd agent drafts PRD          → human comments/iterates → human approves PRD
  → architect drafts design spec  → human comments/iterates → human approves design
  → coder implements in worktree (GoalLoop: tests-first, run the app, verify)
  → draft PR
  → reviewer-a + reviewer-b review (CHANGES → back to coder, loop until both APPROVE)
  → human reads history, approves, merges
  → done
```

## 2. Repo layout (the artifact this spec builds)

Everything lives under this directory (`agent-studio/`). Layout:

```
agent-studio/
├── spec.md                          # this file
├── agentic-engineering-field-guide.md
├── research/                        # normative research: loop-engineering + skills reports
├── README.md                        # what it is, how it works, quickstart, links to labs
├── AGENTS.md                        # house rules for all agents (advisory layer)
├── pyproject.toml                   # python >= 3.11, pytest, ruff; runtime deps stdlib-only (PyYAML allowed)
├── Makefile                         # make test / lint / verify / run / demo
├── config/
│   └── studio.yaml                  # tracker choice, agent registry, models, approvals needed, poll interval
├── studio/                          # the python package (harness core)
│   ├── __init__.py
│   ├── tracker/                     # Tracker interface + implementations
│   │   ├── base.py                  # abstract Tracker
│   │   ├── github.py                # GitHubIssuesTracker (via `gh` CLI)
│   │   └── markdown.py              # MarkdownTracker (local .work/board.md + items/*.md)
│   ├── runtime/                     # ModelRuntime interface + implementations
│   │   ├── base.py                  # abstract ModelRuntime
│   │   ├── claude_code.py           # ClaudeCodeRuntime (`claude -p ...`)
│   │   ├── codex.py                 # CodexRuntime (`codex exec ...`)
│   │   └── fake.py                  # FakeRuntime (scripted responses, for tests/demo)
│   ├── agents/                      # Agent loading + role logic
│   │   ├── base.py                  # Agent dataclass: name, prompt path, runtime, loop config, memory dir
│   │   └── registry.py              # loads agent defs from config + prompts/
│   ├── loop.py                      # GoalLoop: /goal-equivalent Ralph loop (§6) — plan.json queue, harness-owned gates, guardrails, circuit breaker
│   ├── state.py                     # state machine: states, legal transitions, who may transition
│   ├── orchestrator.py              # poll → match → dispatch → transition; single-flight locking
│   └── runs.py                      # runs/<timestamp>/ persistence: prompts, outputs, costs, journal
├── prompts/                         # system prompts, one file per agent role
│   ├── prd.md
│   ├── architect.md
│   ├── coder.md
│   └── reviewer.md                  # shared by both reviewers (runtime differs)
├── memory/                          # per-agent persistent memory (journals, patterns)
│   ├── prd/  architect/  coder/  reviewer/    # each with journal.md seeded with header
├── .claude/
│   ├── settings.json                # pattern-B permissions: allow gh/git/pytest/ruff, deny merge/push-main/.env
│   ├── skills/                      # agentskills.io-standard skills (see §3.3)
│   │   ├── spec-writing/SKILL.md
│   │   ├── acceptance-criteria/SKILL.md
│   │   ├── tdd-workflow/SKILL.md
│   │   ├── run-and-verify/SKILL.md
│   │   └── code-review-rubric/SKILL.md
│   ├── agents/                      # generated native subagent files (studio-<name>.md)
│   └── hooks/
│       ├── guard.sh                 # exit-2 blocks: push to main/master, gh pr merge, force push
│       └── audit.sh                 # JSONL audit trail → .agent-logs/audit.jsonl
├── scripts/
│   ├── verify.sh                    # THE finish line: lint + tests + e2e demo (§17)
│   ├── demo.sh                      # full lifecycle e2e on MarkdownTracker + FakeRuntime, no API keys
│   └── setup-github.sh              # creates the state labels in a target repo via gh
├── deploy/
│   ├── vps.md                       # run 24/7 on a VPS: systemd unit, env, logs, safety notes
│   └── agent-studio.service         # systemd unit template
├── docs/
│   ├── architecture.md              # components, interfaces, state diagram, how to extend
│   └── labs/
│       ├── 01-build-an-app.md       # zero → first version of a web app through the full pipeline
│       ├── 02-add-a-feature.md      # feature request → PRD → design → PR → merge
│       └── 03-fix-a-bug.md          # bug report → (skip PRD) → design-lite → fix PR → merge
└── tests/                           # pytest; no network, no API keys
    ├── test_state.py
    ├── test_tracker_markdown.py
    ├── test_tracker_github.py       # gh calls mocked via injected command executor
    ├── test_runtime.py
    ├── test_loop.py
    ├── test_orchestrator.py
    └── test_e2e_lifecycle.py        # full lifecycle with FakeRuntime + MarkdownTracker
```

## 3. Core abstractions

The whole point is swappable implementations. Each is a small Python ABC; keep them boring.

### 3.1 Tracker (the work queue / state machine store)

```python
class Tracker(ABC):
    def create(self, title, body, state, kind) -> WorkItem: ...
    def get(self, item_id) -> WorkItem: ...
    def list(self, state=None, kind=None) -> list[WorkItem]: ...
    def comment(self, item_id, body, author) -> None: ...
    def comments(self, item_id) -> list[Comment]: ...
    def transition(self, item_id, to_state, actor) -> None: ...   # validates via state machine
    def claim(self, item_id, agent_name) -> bool: ...             # single-flight lock; False if taken
```

`WorkItem`: id, title, body, state, kind (`feature | bug | chore`), assignee, url, created/updated.

- **GitHubIssuesTracker**: labels are states (`studio:<state>`), comments are comments, claim =
  assignee or a `claimed-by:<agent>` label. All via `gh` CLI through an injected command
  executor (so tests can fake it). Never uses the GitHub API directly.
- **MarkdownTracker**: `.work/items/<id>.md` with YAML frontmatter (state, kind, claimed_by)
  plus appended comment sections; `.work/board.md` regenerated as a human-readable kanban
  view. Atomic writes. This is the offline/testing/demo tracker.

### 3.2 ModelRuntime (how an agent's prompt gets executed)

```python
class ModelRuntime(ABC):
    name: str
    def run(self, prompt: str, *, cwd: Path, timeout_s: int) -> RuntimeResult: ...
    def available(self) -> bool: ...    # binary on PATH + auth plausible
```

`RuntimeResult`: output text, exit code, duration, (cost if parseable).

- **ClaudeCodeRuntime**: `claude -p "<prompt>" --output-format text` with configurable
  extra flags (permission mode) from config. cwd matters (worktrees).
- **CodexRuntime**: `codex exec "<prompt>"` equivalent; flags configurable. If the binary
  is missing, `available()` is False and the orchestrator degrades gracefully (§6).
- **FakeRuntime**: constructed with a list/dict of scripted responses; records calls.
  Used by tests and `scripts/demo.sh`.

### 3.3 Agent

An agent is the full bundle: **system prompt + skills + tool permissions + hooks + memory
dir + runtime + optional loop config**. Declarative definition in `config/studio.yaml`:

```yaml
agents:
  prd:        {runtime: claude, prompt: prompts/prd.md,       skills: [spec-writing],            handles: prd:drafting}
  architect:  {runtime: claude, prompt: prompts/architect.md, skills: [spec-writing, acceptance-criteria], handles: design:drafting}
  coder:      {runtime: claude, prompt: prompts/coder.md,     skills: [tdd-workflow, run-and-verify],      handles: ready, loop: {max_iterations: 10, max_minutes: 90}}
  reviewer-a: {runtime: claude, prompt: prompts/reviewer.md,  skills: [code-review-rubric],      handles: pr:agent-review}
  reviewer-b: {runtime: codex,  prompt: prompts/reviewer.md,  skills: [code-review-rubric],      handles: pr:agent-review}
```

**Skills** live in `.claude/skills/<name>/SKILL.md` following the agentskills.io open
standard (YAML frontmatter with `name` matching the directory + `description`; body =
procedural knowledge; optional `scripts/` and `references/` subdirs). Descriptions must be
tight and boring — they drive matching, and "a tight boring description beats a clever
one" (Osmani). Ship at least these
starter skills, each one focused page: `spec-writing` (how to write testable requirements),
`acceptance-criteria` (command + expected result form), `tdd-workflow` (tests first,
red→green), `run-and-verify` (start the app, probe it, capture evidence),
`code-review-rubric` (BLOCKER/SUGGESTION/NIT taxonomy, evidence rules, verdict format).

**Skill delivery is runtime-dependent** (handled by the agent registry, tested):
- Claude runtime: the registry **materializes each studio agent as a native Claude Code
  subagent file** `.claude/agents/studio-<name>.md` — frontmatter `name`, `description`,
  `skills:` (native preloading), `tools`, `memory`; body = the role prompt. Invocation is
  `claude -p "<task context>" --agent studio-<name>`, so Claude Code itself handles skill
  preloading, permissions, and hooks. Generated files are checked in (regenerable via
  `studio init`).
- Codex (and any non-Claude) runtime: the registry **inlines** each referenced SKILL.md
  body into the prompt under a `## Skills` section — portable fallback, same knowledge.

Connectors: an agent's config may carry optional `mcp_servers:` and `hooks:` maps that
pass through verbatim into the generated subagent frontmatter (`mcpServers`/`hooks`).
The harness does not interpret them — it's the documented extension point for wiring
Slack, Linear, browsers, etc. v1 ships none; GitHub access stays via the `gh` CLI.

The task context passed at invocation carries template variables: `{item_id}`,
`{item_title}`, `{item_body}`, `{comments}`, `{memory}`, `{repo_path}`, `{branch}`.
Config referencing a nonexistent skill fails validation with a clear error.

### 3.4 Orchestrator

Plain Python, no LLM. One tick:

1. `tracker.list()` for each state that has a registered agent.
2. For each unclaimed item: `claim()` → build prompt from template + item + memory →
   `runtime.run()` → parse the agent's declared outcome → `transition()` accordingly →
   persist everything under `runs/<timestamp>-<item_id>-<agent>/`.
3. Worktree lifecycle (Osmani's lane discipline): dispatching the coder creates or reuses
   `<target_repo>/../.studio-worktrees/<item_id>` on branch `agent/<id>-<slug>` and runs
   the GoalLoop there; the worktree is removed when the item reaches `done`.
4. Items in human-gated states are skipped (surfaced by `studio status` instead).

Modes: `--once` (single tick, used by tests/demo), `--watch` (poll every
`poll_interval_s`, default 60), `--dry-run` (print what would dispatch).
Concurrency: max one agent per item (claim lock); max N concurrent agents total
(config, default 2). Every tick appends one line to `.agent-logs/orchestrator.log`.

## 4. State machine

States (tracker-agnostic; GitHub labels get a `studio:` prefix):

```
backlog → prd:drafting → prd:review ⇢ prd:approved
        → design:drafting → design:review ⇢ design:approved → ready
        → coding → pr:agent-review → pr:changes-requested → coding (loop)
                 → pr:agent-review → pr:human-review ⇢ done
any state → needs-human (escalation, terminal until a human re-routes)
```

Transition table lives in `studio/state.py` as data (dict), with an `actor` field:
transitions marked ⇢ above are **human-only** (`prd:review→prd:approved`,
`design:review→design:approved`, `pr:human-review→done`);
`pr:agent-review→pr:human-review` is orchestrator-driven, fired only when both reviewer
verdicts are APPROVE. `transition()` raises on
illegal moves or wrong actor class. Bugs may skip PRD: `backlog → design:drafting` is
legal for `kind: bug`.

## 5. Agent behaviors (prompt requirements)

Prompts are the intent layer — write them tight, one page each, following the field-guide
lab prompts as the model. Each must include: role, inputs, exact output contract, what the
agent must NEVER do, the stop rule, and the memory instruction (read
`memory/<role>/journal.md` before starting; append one line of lessons after).

### 5.1 prd

Input: a feature-request work item + all comments. Output: ONE comment containing a PRD
with sections: Problem, Users & jobs-to-be-done, Requirements (functional + non-functional,
each specific and testable), Out of scope, Open questions, Success metrics. If comments
contain human feedback since the last PRD draft, produce a revised PRD addressing every
point. Then transition to `prd:review`. Never writes code, never touches design.

### 5.2 architect

Input: item with an approved PRD. Output: ONE comment with a design spec: Architecture
(components, data flow), Tech choices with rationale (prefer boring; default stdlib),
Files to create/touch, Data model, API contracts, **Acceptance criteria — every item a
command + expected result**, Test plan, Risks. Iterates on human comments like prd.
Transitions to `design:review`. Never writes code.

### 5.3 coder (runs inside the GoalLoop — see §6)

Input: item with approved design. Works in a **git worktree** on branch
`agent/<id>-<slug>`, driven by the GoalLoop: a planning iteration decomposes the design's
acceptance criteria into `plan.json` tasks, then build iterations work one task at a time.
Contract per task: write tests for the acceptance criterion FIRST; implement until green;
**run the app locally and verify behavior** (for web apps: start the server,
curl/playwright the endpoints/pages; for CLIs: run them); fix what's broken; lint clean.
The harness — not the agent — decides when the finish line (all tasks pass + all gates
green) is crossed. Then: draft PR (`gh pr create --draft`) whose body contains the item
id, what changed, and verbatim gate output. Transition → `pr:agent-review`. Non-verified
loop exits escalate per §6.4.

### 5.4 reviewer (shared prompt, two runtimes)

Input: a PR + linked item + design spec. Rules: check out the PR, **run the gates
yourself — never trust pasted output**; judge in order: spec fidelity (execute the
acceptance criteria), correctness, security, test coverage. Post ONE review with findings
classified [BLOCKER]/[SUGGESTION]/[NIT], max 20 comments, and end with a machine-parseable
verdict line: `VERDICT: APPROVE` or `VERDICT: CHANGES`. Any failing gate is an automatic
CHANGES. The orchestrator collects verdicts: both reviewers APPROVE → `pr:human-review`;
any CHANGES → `pr:changes-requested` (coder addresses BLOCKERs next cycle, replies to
every finding, pushes, back to `pr:agent-review`).

## 6. The goal loop (`studio/loop.py`) — a sophisticated Ralph loop

The coder runs inside `GoalLoop`: the studio's equivalent of Claude Code's `/goal`
command, implemented as plain Python. The design is the 2026 state of the art distilled
in `research/loop-engineering-research.md` (Huntley's Ralph, snarktank/ralph,
ralph-orchestrator, frankbria's circuit breaker, ralphex, vercel-labs/ralph-loop-agent,
Anthropic's long-running-agent harnesses, and /goal itself). Its §4 consensus checklist
is normative; the mechanisms below implement it. **The defining property, from /goal and
vercel-labs: the harness owns completion — the model's word is never sufficient.**

```python
class GoalLoop:
    def run(self, agent, item, goal: Goal, workdir) -> LoopResult
# Goal: gates (shell commands that must all exit 0), plan_path, budgets
# LoopResult: reason ∈ {verified, budget-exhausted, thrash, escalated, aborted},
#             iterations, wall_time, gate_report, last_feedback
```

### 6.1 Durable state (`workdir/.loop/`) — files are the only memory

- **`plan.json`** — the priority queue. Written by a **planning iteration** that runs
  first ("plan only, do NOT implement"): decompose the design spec's acceptance criteria
  into ordered tasks `{id, title, steps, acceptance_command, priority, passes: false}`.
  JSON, not markdown — models tamper less with structured data (Anthropic). During build
  iterations the agent may ONLY flip `passes` and append notes; the harness keeps its own
  canonical copy and restores any other mutation (task text, commands, and order are
  immutable). The plan is disposable: a `--replan` flag regenerates it when the loop
  drifts. `.loop/` is gitignored — loop state never rides along in the PR.
- **`progress.md`** — append-only log, one entry per iteration: what was attempted, gate
  results, "learnings for future iterations". A `## Codebase Patterns` section at the top
  collects promoted reusable insights (snarktank pattern).
- **`guardrails.md`** — accumulated signs. Each entry: **Trigger / Instruction / Reason /
  Provenance** (guardrails.md spec). The harness auto-appends one when the same gate
  fails with substantially the same error 3 times ("Trigger: <error>. Instruction: try a
  different approach than <summary of attempts>."). Humans can append too. Injected at
  the END of every prompt — last words win.

### 6.2 Iteration protocol

Each iteration is a **fresh runtime invocation** (new context; no conversation carryover):

1. **Assemble prompt**: role prompt + skills + item/spec context + orientation ritual
   ("read git log, plan.json, progress.md tail; run the smoke test BEFORE new work") +
   plan.json + last N lines of progress.md + **injected feedback** (§6.3) + guardrails.md.
2. **One task rule**: work the single highest-priority task with `passes: false`. One
   task = one iteration = one commit (`feat(<item>): <task-id> <title>`).
3. **Agent runs** via `runtime.run()` in the worktree.
4. **Harness verifies** (never trusts): run the task's `acceptance_command` and the
   standing gates (test, lint, app-smoke) itself. Gate failure → the agent's `passes:
   true` flip is reverted by the harness.
5. **Record**: append to progress.md (harness writes the gate results block even if the
   agent didn't), persist prompt + output + gate report under `runs/`, update counters.

### 6.3 Completion, verification, feedback

- **Finish line**: ALL plan tasks `passes: true` AND all `goal.gates` exit 0, executed by
  the harness on committed work (`git status --porcelain` must be clean — uncommitted
  changes mean the iteration isn't done). Belt-and-braces (frankbria's dual gate): the
  agent must also emit `EXIT_SIGNAL: COMPLETE` — but the signal alone NEVER completes the
  loop, and gates passing without the signal simply triggers one confirmation iteration.
- **Failure-feedback injection** (vercel-labs / /goal): when gates fail, the harness
  distills the failing command + last 50 lines of its output into the next iteration's
  `## Why the previous iteration did not complete` section.
- **Test integrity check**: tests may be added, never deleted; the harness counts test
  functions per gate run — a drop from a previously green iteration fails the gate and
  appends a guardrail (Anthropic: "unacceptable to remove or edit tests").

### 6.4 Stop rules — layered, OR-combined, each with a distinct exit reason

- `max_iterations` (default 10) or `max_minutes` (default 90) → `budget-exhausted`.
- Circuit breaker (frankbria): 3 consecutive iterations with no git diff, or 5 with the
  same gate failing on substantially the same error → `thrash`.
- Agent emits `NEEDS_HUMAN: <question>` → `escalated`.
- SIGINT/SIGTERM → `aborted` (state files make resume trivial: rerun continues from the
  first `passes: false` task).

Any non-`verified` exit writes a structured progress report as a comment on the work item
and transitions it to `needs-human`. Exit reasons are distinct values on `LoopResult` and
map to process exit codes (0 verified, 1 budget, 2 thrash, 3 escalated) so outer
automation can branch.

### 6.5 Degraded runtimes

If a configured runtime is unavailable (e.g. codex not installed), the orchestrator logs
a warning; with `approvals_required: 2` and only one reviewer available it proceeds with
one and notes it in the PR (config `allow_degraded_review: true|false`, default true).

## 7. Memory

- `memory/<role>/journal.md` — append-only lessons ("what I tried / what I learned"),
  injected (tail, last ~50 lines) into every prompt for that role.
- `AGENTS.md` at repo root — house rules all agents read; agents may PROPOSE changes as a
  comment but never edit it (human applies).
- Target-project memory: when working in an app repo, agents respect and update that
  repo's CLAUDE.md/AGENTS.md per its own rules.
- Stretch (not required for acceptance): a curator agent that distills journals weekly.

## 8. Safety floor (enforced, not advised)

- `.claude/settings.json`: allow pytest/ruff/gh issue/gh pr(non-merge)/git branch-scoped
  push; deny `gh pr merge`, `git push origin main`, force push, `rm -rf`, reading
  `.env`/`~/.ssh`/`~/.aws`.
- `guard.sh` PreToolUse hook: regex-blocks main/master pushes, merges, force pushes —
  **exit 2** (only exit 2 blocks). `audit.sh` PostToolUse hook: JSONL log of every tool call.
- Agents never merge, never push to main, never close human-gated items.
- All loops have stop rules (§6). `.agent-logs/` is gitignored.

## 9. Configuration (`config/studio.yaml`)

```yaml
tracker: {kind: github, repo: owner/name}    # or {kind: markdown, root: .work}
runtimes:
  claude: {cmd: claude, extra_flags: ["--permission-mode", "acceptEdits"]}
  codex:  {cmd: codex,  extra_flags: []}
approvals_required: 2
allow_degraded_review: true
poll_interval_s: 60
max_concurrent_agents: 2
target_repo: .            # path to the app repo the agents build in
agents: { ...as §3.3... }
```

Config is validated at load with clear errors. `studio.yaml` ships with markdown-tracker
defaults so the demo works with zero setup; `README` shows the GitHub variant.

## 10. CLI entry points

`python -m studio <cmd>` (argparse, stdlib):

- `studio init` — validate config, create memory/ and .work/ scaffolding, check runtimes.
- `studio new "title" --kind feature --body "..."` — file a work item into the backlog
  and move it to `prd:drafting` (or `design:drafting` for bugs).
- `studio approve <id>` — human gate: advances `prd:review→prd:approved→design:drafting`
  or `design:review→design:approved→ready` (whichever applies).
- `studio run --once|--watch|--dry-run` — the orchestrator.
- `studio status` — board view: every item, state, who's on it, what needs the human.
- `studio demo` — runs `scripts/demo.sh` (see §12).

Makefile: `make test` (pytest -q), `make lint` (ruff check .), `make verify`
(scripts/verify.sh), `make demo`, `make run`.

## 11. Testing requirements

All tests offline — no network, no API keys, no `claude`/`codex`/`gh` binaries required
(subprocess boundaries injected/mocked).

- **Unit**: state machine (legal/illegal transitions, actor enforcement), MarkdownTracker
  (CRUD, comments, claim atomicity, board render), GitHubIssuesTracker (correct `gh`
  argv construction via fake executor), runtimes (argv, timeout, availability), GoalLoop
  (planning iteration produces plan.json; one-task-per-iteration; harness gate
  re-verification overrides a lying agent; failure-feedback injection; guardrail
  auto-append after 3 same-error failures; plan-tamper restore; test-count drop fails the
  gate; circuit-breaker thrash exit; budget exits; EXIT_SIGNAL alone does not complete;
  resume from first failing task; distinct exit reasons/codes), config
  validation, orchestrator dispatch (claims, skips human-gated states, honors concurrency),
  agent registry (skill resolution, native subagent-file generation for claude runtime,
  SKILL.md inlining for codex runtime, error on unknown skill).
- **E2E** (`test_e2e_lifecycle.py`): with MarkdownTracker + FakeRuntime scripted for every
  role, drive a feature item through the FULL lifecycle — backlog → PRD → (simulated human
  approve) → design → approve → coding → both reviewer verdicts (first CHANGES then
  APPROVE to exercise the review loop) → pr:human-review → done — asserting state, comments,
  runs/ artifacts, and journal writes at each step.
- Coverage of `studio/` ≥ 80% (pytest-cov), enforced in verify.sh.

## 12. Demo (`scripts/demo.sh`)

Non-interactive proof the machine works end to end without API keys: temp dir, markdown
tracker, FakeRuntime with canned PRD/design/code/review outputs, orchestrator `--once`
ticks interleaved with simulated human approvals, printing the board between ticks.
Exits 0 only if the item reaches `done`. This is both the smoke test and the first thing
a new user runs.

## 13. Documentation

- **README.md**: what/why (3 paragraphs max, link the field guide), architecture diagram
  (ASCII), quickstart (clone → `make demo` → configure GitHub → first real item), the two
  human touchpoints, links to labs and docs. A newcomer must get from clone to green demo
  in under 5 minutes.
- **docs/architecture.md**: the abstractions, state diagram, how to add a tracker /
  runtime / agent / skill, how the goal loop works (with the §6 mechanisms and why each
  exists, citing research/), safety model.
- **docs/labs/01-build-an-app.md**: hands-on — scaffold a tiny web app (e.g. Flask
  todo API) from zero: file the feature request, iterate on the PRD, approve, iterate on
  design, approve, watch the coder loop, read the reviews, merge. Every command shown.
- **docs/labs/02-add-a-feature.md**: add a feature to that app through the pipeline.
- **docs/labs/03-fix-a-bug.md**: bug report path (skips PRD), fix, regression test, merge.
- **deploy/vps.md**: Ubuntu VPS: install, auth (`claude` + `gh` + optional codex), the
  systemd unit (`studio run --watch`), log locations, and the safety posture required
  before enabling (container/user isolation, no credential mounts — cite field guide §3
  Pattern C).

## 14. Implementation constraints

- Python ≥ 3.11, stdlib + PyYAML only at runtime; pytest/pytest-cov/ruff as dev deps.
- Type hints throughout; `ruff check .` clean with default rules + `I` (import sorting).
- No LLM framework, no LangChain — the loop is ~plain code you can read at 2am.
- External processes (`gh`, `claude`, `codex`, `git`) always via one injected
  `CommandExecutor` seam so everything is testable.
- Small files, one concern each; no file > ~300 lines.

## 15. Build order (milestones — commit after each, message `feat(studio): M<N> <name>`)

1. **M1 skeleton**: pyproject, Makefile, package layout, config loader + validation, CLI
   stub, state machine + tests green.
2. **M2 trackers**: MarkdownTracker + GitHubIssuesTracker + tests.
3. **M3 runtimes**: base + claude/codex/fake + tests.
4. **M4 loop**: GoalLoop (plan.json, gates, guardrails, circuit breaker, feedback
   injection) + runs/ persistence + tests.
5. **M5 orchestrator**: dispatch, claiming, verdict parsing, degraded review + tests.
6. **M6 agents**: the four prompt files, the five starter skills, agent registry
   (incl. subagent-file generation + skill inlining), memory seeding.
7. **M7 e2e**: full-lifecycle test + demo.sh green.
8. **M8 safety**: settings.json, guard.sh, audit.sh, setup-github.sh.
9. **M9 docs**: README, architecture, three labs, vps.md + systemd unit.
10. **M10 hardening**: verify.sh assembles everything; fix whatever it finds; final pass
    of `make verify` green.

## 16. Out of scope (v1)

Linear/ADO tracker implementations (interface must accommodate them; don't build), the
curator agent, a discovery/triage agent (Osmani's scheduled-discovery automation — the
orchestrator's `--watch` poll is the v1 heartbeat; `studio status` is the v1 inbox),
cost dashboards, Slack/Telegram notification, multi-repo orchestration,
GitHub Actions workflows (docs may mention them; don't build), sandboxed container images,
MCP connector implementations (the §3.3 passthrough is the extension point).

## 17. Acceptance criteria — THE FINISH LINE

`./scripts/verify.sh` must implement exactly these checks, exit non-zero on any failure,
and print a ✅/❌ checklist. The build is done when it exits 0.

1. `ruff check .` → clean.
2. `python -m pytest -q` → all green, ≥ 25 tests collected.
3. Coverage of `studio/` ≥ 80%.
4. `scripts/demo.sh` → exits 0; its output shows the item reaching `done` and at least
   one `pr:changes-requested` → re-review cycle occurred.
5. `python -m studio run --dry-run --once` with the default (markdown) config → exits 0.
6. `python -m studio status` → exits 0 and renders a board.
7. Config sanity: loading `config/studio.yaml` succeeds; loading a config with an unknown
   state or missing prompt file fails with a clear error (asserted in tests, and verify.sh
   greps that those tests exist and ran).
8. State machine: tests prove human-only transitions reject an `agent` actor.
9. Files exist and are non-trivial (>40 lines each): README.md, docs/architecture.md,
   docs/labs/01-build-an-app.md, docs/labs/02-add-a-feature.md, docs/labs/03-fix-a-bug.md,
   deploy/vps.md, all four prompts/, .claude/settings.json, .claude/hooks/guard.sh,
   .claude/hooks/audit.sh, AGENTS.md. All five .claude/skills/*/SKILL.md exist with valid
   frontmatter (`name` matching directory, non-empty `description`) — checked by a test.
10. guard.sh: piping a synthetic PreToolUse JSON payload containing
    `git push origin main` into it exits 2; a payload with `git push origin agent/x` exits 0.
11. README quickstart commands, executed in order in a clean temp clone, reach a green
    `make demo` (verify.sh simulates this by running `make demo` from a fresh
    `git worktree`/copy).
12. Prompt files each contain: a role statement, an output contract, a NEVER list, a stop
    rule, and the memory instruction (verify.sh greps for required section markers).
13. Harness-owned completion is proven by tests: a scripted FakeRuntime that flips every
    plan task to `passes: true` and emits `EXIT_SIGNAL: COMPLETE` while a gate command
    still fails does NOT produce a `verified` LoopResult; the run exits `thrash` or
    `budget-exhausted` with the gate failure recorded in progress.md and injected into
    the next iteration's prompt (verify.sh confirms these tests exist and ran).
