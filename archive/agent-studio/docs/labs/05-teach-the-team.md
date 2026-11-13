# Lab 5 — Teach the team

Goal: exercise every channel through which the agents learn — a new skill, journal
memory, and a promoted house rule — and *prove* each one lands in an agent's prompt,
offline. Time: ~30 minutes. Uses:
[agents, skills, runtimes](../architecture/04-agents-skills-runtimes.md).

## 1. Write a skill

Your project surely has conventions the agents keep rediscovering. Codify one:

```sh
mkdir -p .claude/skills/api-conventions
cat > .claude/skills/api-conventions/SKILL.md <<'EOF'
---
name: api-conventions
description: HTTP API conventions for this project. Use when designing or implementing endpoints.
---

# API conventions

- Routes are plural nouns: `/todos`, never `/todo` or `/getTodos`.
- Errors are always `{"error": "<human-readable message>"}` with the right 4xx/5xx.
- Every endpoint has: a happy-path test, a 4xx test, and an entry in README's API table.
- Timestamps are ISO-8601 UTC, field names end in `_at`.
EOF
```

Frontmatter rules that matter: `name` must match the directory, and the
`description` should be tight and boring — it drives when the skill gets picked up.

## 2. Wire it and regenerate

In `config/studio.yaml`, add it to the two agents that touch APIs:

```yaml
  architect:
    skills: [spec-writing, acceptance-criteria, api-conventions]
  coder:
    skills: [tdd-workflow, run-and-verify, api-conventions]
```

```sh
python -m studio init
```

Checkpoint — the claude delivery path (native preloading):

```sh
grep -A4 'skills:' .claude/agents/studio-coder.md
```

```text
skills:
  - tdd-workflow
  - run-and-verify
  - api-conventions
```

## 3. Prove the codex delivery path (inlining)

reviewer-b runs on codex, which has no native skills — the registry inlines them.
Prove it without any API call:

```sh
.venv/bin/python - <<'EOF'
from studio.agents.registry import AgentRegistry
from studio.config import load_config
from studio.tracker.base import WorkItem

cfg = load_config("config/studio.yaml")
item = WorkItem(id="0", title="probe", body="", state="pr:agent-review")
prompt = AgentRegistry(cfg).build_prompt(cfg.agents["reviewer-b"], item)
print("## Skills section present:", "## Skills" in prompt)
print("rubric inlined:", "Evidence first" in prompt or "rubric" in prompt.lower())
EOF
```

Checkpoint: both lines print `True`. Same knowledge, two delivery mechanisms —
that's the [runtime-dependent delivery](../architecture/04-agents-skills-runtimes.md)
working.

## 4. Journal memory: seed it, see it

Every role reads its journal's tail in every task context. Seed a lesson and prove
the round trip:

```sh
echo "- 2026-07-07 human strongly prefers stdlib over dependencies; propose deps only with rationale" \
  >> memory/architect/journal.md
```

```sh
.venv/bin/python - <<'EOF'
from studio.agents.registry import AgentRegistry
from studio.config import load_config
from studio.tracker.base import WorkItem

cfg = load_config("config/studio.yaml")
item = WorkItem(id="0", title="probe", body="", state="design:drafting")
ctx = AgentRegistry(cfg).task_context(cfg.agents["architect"], item)
print("lesson in context:", "stdlib over dependencies" in ctx)
EOF
```

Checkpoint: `lesson in context: True`. In live use the agents append these lines
themselves (their prompts' Memory sections require it); your job is the weekly read
([daily workflow](../guide/02-daily-workflow.md)).

## 5. Promote a lesson to a house rule

Journals are per-role; [AGENTS.md](../../AGENTS.md) is for everyone. The protocol —
agents *propose*, humans *apply* — matters more than the mechanics: it keeps the
advisory layer curated by the one party accountable for it. Simulate the full loop:
pick the journal lesson above, add it under "Working agreements" in AGENTS.md
yourself, and note the date. (Live, a reviewer's journal pattern arrives as a
work-item comment proposing exactly this edit.)

## 6. Clean up (or don't)

The skill, journal line, and house rule are all real improvements — keep them if
they fit your project. Revert with `git checkout -- .claude config memory AGENTS.md`
otherwise.

## What you learned

- The three learning channels and their scopes: skills (procedures, per-agent),
  journals (accumulated lessons, per-role), AGENTS.md (rules, everyone).
- Skill delivery is runtime-dependent, and you can prove both paths land without
  spending a token.
- `studio init` is the regeneration step after any prompt/skill/config change —
  native subagent files are generated artifacts.
- The propose-then-apply protocol keeps humans owning the intent layer.
- Teaching the team is cheaper than correcting it: one skill file outlives a
  hundred review comments.

---

[← Lab 4: Watch the loop save itself](04-watch-the-loop-save-itself.md) ·
[Index](../README.md) · [Lab 6: Extend the studio →](06-extend-the-studio.md)
