# Agent Studio — Self-Improving Agents Specification

Follow-on to [spec.md](spec.md) (the v1 contract, which stays authoritative for
everything it covers). This spec adds a second, **self-improving agent set** alongside
the existing agents — the existing five (`prd`, `architect`, `coder`, `reviewer-a`,
`reviewer-b`) and their prompts are never modified or deleted — and a config switch to
choose which set runs.

## 1. Design position

Self-improvement here is **loop engineering, not self-modification**. Agents do not
rewrite their own prompts mid-flight. Instead:

- The **harness measures** every run (plain code, no LLM) into a per-agent scorecard.
- Agents emit structured **lessons** each run; the harness — not the agent — persists
  them to the role journal, so reflection can't be skipped.
- A new **improver agent** periodically turns scorecard + journals + run transcripts
  into a concrete *proposal*: a unified diff against the evolving set's prompt/skill
  files, with the metric it expects to move.
- A **human approves** every proposal before the harness applies it (a third human
  power, same shape as spec approval and merge). The harness enforces a path
  allowlist, commits each applied change, and **auto-proposes a revert** if the target
  metric regresses. Git history is the version history.

The improvement pipeline reuses the machinery that already exists: proposals are work
items, gates are code, transitions are actor-checked, everything is a file.

## 2. Agent sets (config)

R1. `config/studio.yaml` MAY define `agent_sets:` (a map of set name → `{agents: ...}`)
    plus top-level `active_set: <name>`. `load_config` exposes only the active set's
    agents as `StudioConfig.agents`; observable by a unit test asserting
    `cfg.agents.keys()` for each `active_set` value.

R2. Backward compatibility: a config with a bare top-level `agents:` and no
    `agent_sets:` loads exactly as today (treated as the sole, active set). The
    current shipped `config/studio.yaml` must load unchanged; observable by the
    existing `test_config.py` passing without modification.

R3. `active_set` naming an undefined set, or `agent_sets` present with no
    `active_set`, raises `ConfigError` naming the bad key and the valid set names.

R4. The shipped config defines two sets: `classic` (byte-for-byte today's five agents,
    pointing at the existing `prompts/*.md`) and `evolving` — the same five roles
    pointing at `prompts/evolving/<role>.md`, plus an `improver` agent. `active_set:
    classic` is the shipped default. Files under `prompts/` (classic) are never
    written by any part of the improvement pipeline.

R5. `prompts/evolving/<role>.md` starts as a copy of the classic prompt with one added
    section: the Reflection output contract (§5). `studio init` generates native
    subagent files only for the active set's agents; observable by listing
    `.claude/agents/studio-*.md` after `init` under each `active_set`.

## 3. State machine and item kinds

R6. New states: `improve:drafting → improve:review ⇢ improve:approved → done`, and
    `improve:review → needs-human`. The ⇢ transition (`improve:review →
    improve:approved`) is **human-only**: calling `transition()` with `Actor.AGENT` or
    `Actor.ORCHESTRATOR` raises, observable by a unit test.

R7. New item kind `improvement`. Kind-guard both ways: `improvement` items are only
    dispatchable to agents whose `handles` is an `improve:*` state, and non-improvement
    items never enter `improve:*` states; `transition()` raises on violations.

R8. At most ONE improvement item may be open (any non-`done`, non-`needs-human`
    `improve:*` state) at a time; the trigger (R17) declines to file a second and logs
    why. Prevents proposal thrash.

## 4. Scorecard (harness-computed, no LLM)

R9. New module `studio/metrics.py` computes per-agent metrics by reading
    `.agent-logs/events.jsonl` and the tracker. Minimum metric set:
    - coder: loop iterations per verified item; escalation rate (`needs-human` exits ÷
      dispatches); review rounds per item (times through `pr:changes-requested`).
    - reviewer-a/b: rounds until unanimous APPROVE; disagreement rate between the two.
    - prd / architect: first-pass approval rate (human approved without the item ever
      re-entering drafting).

R10. `python -m studio scorecard [--json]` prints the scorecard; `--json` emits one
     JSON object parseable by `jq -e`. Metrics with no data render as `null`, never 0
     (0 iterations and no data are different facts).

R11. When an item reaches `done`, the orchestrator appends one scorecard snapshot line
     to `memory/scorecard.jsonl` (append-only JSONL: item id, per-agent metrics at
     that point). This file is the regression-guard baseline (R23).

R12. Metrics are computed identically for both sets, so classic vs evolving can be
     compared with the same command: `studio scorecard --set classic|evolving` filters
     by the set that ran each item (recorded in the snapshot line).

## 5. Reflection (lessons the harness persists)

R13. Evolving-set prompts require agents to end output with zero or more lines
     `LESSON: <one durable, project-wide sentence>`. The orchestrator parses them from
     agent output (commenters and reviewers: run output; coder: each iteration's
     output) and appends each — prefixed with item id — to
     `memory/<role>/journal.md`. Agent-written journal appends remain allowed;
     harness parsing makes reflection guaranteed rather than advisory.

R14. Parsing is bounded: max 3 LESSON lines per run are persisted (rest dropped, event
     logged), each truncated at 200 chars. A run with no LESSON lines is not an error.

R15. Every persisted lesson also emits a `lesson` event to events.jsonl (item, agent,
     text) so the console can surface them.

## 6. The improver agent

R16. `improver` is a normal declarative agent in the `evolving` set: `handles:
     improve:drafting`, its own prompt `prompts/evolving/improver.md`, and a new skill
     `.claude/skills/prompt-audit/SKILL.md` (how to read a scorecard, diagnose a
     failure pattern in run transcripts, and write a minimal prompt diff). It is
     dispatched by the existing commenter shape — no new dispatch machinery.

R17. Trigger: when the evolving set is active and `improve_every: N` (config, default
     5, must be ≥ 1) items have reached `done` since the last improvement item was
     filed, the orchestrator files one work item (kind `improvement`, state
     `improve:drafting`) whose body embeds the current scorecard, the delta since the
     last improvement, and the run-dir paths of the worst-scoring recent runs. Also
     manual: `python -m studio improve` files the same item on demand (subject to R8).

R18. The improver's output contract (machine-parseable, enforced by the orchestrator):
     a rationale, then exactly one fenced ```diff block (unified diff), then a final
     line `EXPECT: <agent>.<metric> <decrease|increase>`. Output missing any part →
     item goes to `needs-human` with the parse failure quoted; nothing is applied.

R19. The diff may touch ONLY files under `prompts/evolving/` and
     `.claude/skills/prompt-audit/`. The **harness** validates every path in the diff
     against this allowlist before the item may leave `improve:drafting`; a violation
     sends the item to `needs-human` naming the offending path. (Enforced in code —
     the improver's prompt also says so, but prose is not the guard.)

R20. On a valid proposal the orchestrator posts it as a comment and transitions the
     item to `improve:review`. `studio status` lists it under "Needs you".

## 7. Apply, watch, revert

R21. `python -m studio approve <id>` on an `improve:review` item: re-validates the
     allowlist, dry-runs `git apply --check`, applies the diff, commits
     `improve(<set>): item <id> — <first rationale line>` (staging only allowlisted
     paths), regenerates subagent files, transitions to `improve:approved` then
     `done`, and appends a record to `memory/improvements.jsonl`: item id, files,
     EXPECT clause, baseline metric value, `status: watching`. A failing
     `git apply --check` → `needs-human`, nothing written.

R22. Rejection: `python -m studio reject <id> [--reason ...]` (new command, works on
     any human-gated state) comments the reason and returns the item to
     `needs-human`. Nothing is applied.

R23. Regression guard: after each subsequent `done` item, for every `watching` record
     with ≥ `improve_every` post-apply snapshots, compare the EXPECT metric against
     its recorded baseline. Improved-or-flat → `status: kept`. Worsened by more than
     20% relative → the harness files a revert proposal: an improvement item whose
     diff is the exact inverse of the applied one (git-generated, not LLM-generated),
     body quoting baseline vs current numbers. It goes through the same human gate.

R24. `python -m studio improvements` lists the log: id, date, files, expected vs
     actual metric movement, status (`watching | kept | reverted | rejected`).

R25. Rollback safety: because every apply is one commit touching only allowlisted
     paths, `git revert <sha>` always restores the prior prompts; the revert-proposal
     diff (R23) must be byte-identical to what `git revert` would produce, observable
     by a test.

## 8. Safety floor (additions)

- The improvement pipeline never writes outside the R19 allowlist — enforced at
  proposal validation (R19) AND at apply time (R21); both raise independently.
- Never modifiable by any agent or by apply: `prompts/*.md` (classic), `AGENTS.md`,
  `spec.md`, this file, `studio/**`, `.claude/settings.json`, `.claude/hooks/**`.
- The human gate on `improve:review` is actor-enforced in the state machine (R6),
  same as spec approval and merge.
- One improvement in flight (R8); improver runs are budgeted like any commenter
  (single invocation, no loop).

## 9. Out of scope (this iteration)

- Automatic A/B evaluation (running both sets on the same item and comparing).
- Improver edits to skills other than `prompt-audit`, to guardrails, to `AGENTS.md`,
  or to loop budgets/config.
- Cross-role proposals (one item = changes for one role only).
- Statistical significance testing on metrics; the 20% threshold is a heuristic.
- Online/mid-item prompt swapping — set changes take effect at the next dispatch.

## 10. Open questions (decide during build, record in DECISIONS.md)

- Q1. Should reviewer journals stay shared (`memory/reviewer/`) for the evolving set,
  or split per reviewer so lessons don't cross models? Default: keep shared.
- Q2. Scorecard attribution when an item was worked by both sets (set switched
  mid-item). Default: attribute to the set active at `done`.

## 11. Acceptance criteria — THE FINISH LINE

Machine-runnable, offline, FakeRuntime only. Collected in
`scripts/verify-improve.sh`; each check exits 0 on success.

1. `python -m pytest -q` — entire suite green, existing tests unmodified (R2).
2. `ruff check .` — lint clean.
3. `python -m pytest tests/test_agent_sets.py -q` — R1/R3/R4: active-set selection,
   error cases, backward compat with a bare `agents:` config.
4. `sh -c 'python -m studio scorecard --json | jq -e ".agents"'` — R10 (run against a
   fixture events.jsonl checked into tests/fixtures/).
5. `python -m pytest tests/test_reflection.py -q` — R13–R15: LESSON parsing, journal
   append, 3-line cap, lesson events.
6. `python -m pytest tests/test_improver.py -q` — R17/R18/R20: trigger cadence,
   output-contract parsing, malformed output → needs-human, R8 single-flight.
7. `python -m pytest tests/test_improve_allowlist.py -q` — R19/R21: diff touching
   `studio/` or classic `prompts/` is rejected at both validation and apply.
8. `python -m pytest tests/test_improve_gate.py -q` — R6/R7: agent-actor transition
   to `improve:approved` raises; kind-guard both directions.
9. `python -m pytest tests/test_improve_apply.py -q` — R21/R22/R25: apply commits
   only allowlisted paths, records to improvements.jsonl, regenerates subagents;
   reject applies nothing; revert diff equals `git revert` output.
10. `python -m pytest tests/test_regression_guard.py -q` — R23: worsened fixture
    metric files a revert proposal; improved one flips status to `kept`.
11. `sh -c 'python -m studio.demo --improve | grep -q "improve:review"'` — scripted
    end-to-end demo: N items done → improvement item filed → FakeRuntime improver
    proposes → human-scripted approve → diff applied → visible in `improvements`.
12. `sh -c './scripts/verify.sh'` — the original 13-point v1 checklist still passes:
    classic set untouched.
