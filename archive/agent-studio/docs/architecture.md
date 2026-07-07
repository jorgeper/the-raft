# Architecture

Four swappable abstractions, one plain-code orchestrator, one goal loop. No LLM
framework anywhere — when it goes sideways at 2am, it's code you can read.

This page is a signpost: the full architecture documentation now lives in
[the Agent Studio Book](README.md), Part 2, expanded chapter by chapter. Start at
the [system overview](architecture/01-system-overview.md) for the map and one work
item's complete journey.

## Where everything went

| You want | Read |
|---|---|
| the full map, the pieces table, one item's journey in files | [architecture/01 — System overview](architecture/01-system-overview.md) |
| states, actors, human gates, the kind-guard for bugs | [architecture/02 — The state machine](architecture/02-state-machine.md) |
| the Tracker interface, markdown vs GitHub backends, claims | [architecture/03 — Trackers and work items](architecture/03-trackers-and-work-items.md) |
| agent bundles, SKILL.md, native subagents vs inlining, memory | [architecture/04 — Agents, skills, runtimes](architecture/04-agents-skills-runtimes.md) |
| the GoalLoop deep dive: plan.json, gates, guardrails, breakers | [architecture/05 — GoalLoop internals](architecture/05-goal-loop-internals.md) |
| ticks, review rounds, degraded mode, the enforcement stack | [architecture/06 — Orchestrator and safety](architecture/06-orchestrator-and-safety.md) |

## The one-paragraph version

Work items live in a tracker (markdown files or GitHub Issues) whose states form a
machine with actor-enforced transitions — the human gates (approve PRD, approve
design, merge) are code that raises, not prose that suggests. A plain-Python
orchestrator polls the tracker, claims items, and dispatches agents by state: two
spec-writing commenters, a coder that hill-climbs inside a Ralph-style GoalLoop
where the harness re-runs every gate itself and the model's word moves nothing, and
two reviewers on different models whose unanimous machine-parseable verdicts are the
only path to your merge queue. Every dispatch is persisted under `runs/`, every
tool call audited, every loop budgeted and circuit-broken.

## Extending

The extension points — new tracker, new runtime, new agent, new skill — are
summarized at the end of each Part 2 chapter and exercised hands-on in
[Lab 6](labs/06-extend-the-studio.md). The design principles they follow (and the
sources behind them) are Part 1 of the book:
[concepts/01](concepts/01-from-prompts-to-loops.md) through
[concepts/05](concepts/05-autonomy-and-safety.md).

## History

This file was the original single-page architecture doc, written at milestone M9 of
the [build spec](../spec.md). The book superseded it; the deep-dive chapters carry
everything it said plus the mechanism-by-mechanism detail, diagrams, and provenance
links the one-pager didn't have room for.
