# Configuration

*Every key in `config/studio.yaml`, its default, and — more usefully — when you'd
actually change it. Validation is strict: a bad config fails at load with the field
named, never inside a running orchestrator.*

## The file at a glance

```yaml
tracker: {kind: markdown, root: .work}

runtimes:
  claude: {cmd: claude, extra_flags: ["--permission-mode", "acceptEdits"]}
  codex: {cmd: codex, extra_flags: []}

approvals_required: 2
allow_degraded_review: true
poll_interval_s: 60
max_concurrent_agents: 2
target_repo: .

agents:
  prd:        {runtime: claude, prompt: prompts/prd.md, skills: [spec-writing], handles: prd:drafting}
  architect:  {runtime: claude, prompt: prompts/architect.md, skills: [spec-writing, acceptance-criteria], handles: design:drafting}
  coder:      {runtime: claude, prompt: prompts/coder.md, skills: [tdd-workflow, run-and-verify], handles: ready,
               loop: {max_iterations: 10, max_minutes: 90}}
  reviewer-a: {runtime: claude, prompt: prompts/reviewer.md, skills: [code-review-rubric], handles: pr:agent-review, memory: reviewer}
  reviewer-b: {runtime: codex,  prompt: prompts/reviewer.md, skills: [code-review-rubric], handles: pr:agent-review, memory: reviewer}
```

## Top-level keys

| Key | Default | Change it when... |
|---|---|---|
| `tracker.kind` | `markdown` | going live: `github` with `repo: owner/name` ([guide/04](04-going-live-on-github.md)). `markdown` keeps state in `tracker.root` (default `.work`) |
| `approvals_required` | `2` | you add a third reviewer (Lab 6 → `3`), or run cheap with one (`1`) |
| `allow_degraded_review` | `true` | set `false` when you'd rather items *wait* than be reviewed by fewer models than required — stricter, slower |
| `poll_interval_s` | `60` | new setup: crank it up (`3600`) so nothing moves unwatched; VPS steady-state: `120` is plenty |
| `max_concurrent_agents` | `2` | raise only when items queue up AND you're reading everything comfortably; this is your cost throttle too |
| `target_repo` | `.` | always, in real use: the path to the app repo the agents build in (worktrees are cut from it) |

## Runtimes

Each entry: `cmd` (the binary), `extra_flags` (appended verbatim to every
invocation), and optional `kind` (`claude` | `codex`) when the name isn't one of
those. Useful variants:

```yaml
runtimes:
  claude:        {cmd: claude, extra_flags: ["--permission-mode", "acceptEdits"]}
  fast-reviewer: {cmd: claude, kind: claude, extra_flags: ["--model", "haiku"]}
```

`extra_flags` is where the claude runtime's permission mode lives — tighten it to
taste; the [enforcement stack](../architecture/06-orchestrator-and-safety.md) holds
regardless. If a runtime's binary is missing, `available()` is false: commenter and
coder dispatches will fail visibly; review rounds degrade per
`allow_degraded_review`.

## Agents

| Key | Required | Notes |
|---|---|---|
| `runtime` | ✓ | must name a configured runtime |
| `prompt` | ✓ | path relative to the studio root; must exist |
| `handles` | ✓ | the state this agent picks work from; must be a real state |
| `skills` | — | each must exist at `.claude/skills/<name>/SKILL.md`; delivery is runtime-dependent ([how](../architecture/04-agents-skills-runtimes.md)) |
| `loop` | — | presence makes it a GoalLoop agent: `{max_iterations, max_minutes}`; it also auto-handles `pr:changes-requested` |
| `memory` | — | journal directory under `memory/`; defaults to the agent name — both reviewers share `reviewer` |
| `mcp_servers`, `hooks` | — | passthrough into the generated native subagent frontmatter; the harness doesn't interpret them (the extension point for connectors) |

Tuning the coder's `loop:` budgets: prefer *smaller tasks* over bigger budgets —
iterations are cheap when acceptance criteria are sharp, and a 10-iteration loop
that thrashes is telling you about the spec, not the budget
([GoalLoop internals](../architecture/05-goal-loop-internals.md)).

## Validation and regeneration

```sh
python -m studio init
```

Run it after every config edit: it re-validates, re-seeds `memory/`, and
**regenerates the native subagent files** (`.claude/agents/studio-*.md`) — required
whenever you change prompts, skills, or agent definitions on the claude runtime,
because that's where those live at invocation time. Error messages name the field:

```text
config error: agents.prd.handles: unknown state 'prd:wat' (valid: backlog, coding, ...)
config error: agents.coder.skills: unknown skill 'tdd-worfklow' (.claude/skills/tdd-worfklow/SKILL.md missing)
```

## Alternate configs

`--config` on any command picks a different file — handy for a per-project studio
config living *in* the target repo, or an experiment config with looser budgets:

```sh
python -m studio --config ../my-app/studio.yaml status
```

---

[← Daily workflow](02-daily-workflow.md) · [Index](../README.md) ·
[Going live on GitHub →](04-going-live-on-github.md)
