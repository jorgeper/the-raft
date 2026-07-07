# Ralph Loops / Autonomous Agentic Coding Loops — State of the Art (2025–2026)

*Research compiled 2026-07-06 to ground spec.md §6 (the goal loop). The consensus
checklist in §4 is normative for the implementation.*

## 1. The Original Technique — Geoffrey Huntley's "Ralph Wiggum as a software engineer"

Primary sources: https://ghuntley.com/ralph/ · https://github.com/ghuntley/how-to-ralph-wiggum · https://ghuntley.com/loop/ ("Everything is a Ralph Loop") · https://ghuntley.com/pressure/ ("Don't Waste Your Back Pressure") · https://ghuntley.com/cursed/ (3-month case study building a language) · https://www.humanlayer.dev/blog/brief-history-of-ralph

**Core loop.** The entire orchestrator is:

```bash
while :; do cat PROMPT.md | claude-code ; done
```

Every iteration is a brand-new process with a **fresh context window**; all memory is
externalized to files and git. Huntley frames it as "deterministic failure in
nondeterministic ways" — you tune the operator (prompts/signs/specs), not the tool.

**File architecture (loaded each iteration):**
- `PROMPT.md` — the per-iteration instruction set; two variants (planning vs building mode).
- `@fix_plan.md` / `IMPLEMENTATION_PLAN.md` — persistent prioritized TODO list; the shared
  state between isolated context windows. Ralph picks the most important item, marks items
  complete in-place. "The plan is disposable" — regenerate it via a planning loop when
  Ralph drifts or the plan feels stale.
- `@specs/*` — one markdown spec per topic of concern; the source of truth.
- `@AGENT.md` / `AGENTS.md` (≤60 lines) — operational guide: how to build/run/test; Ralph
  self-updates it with learned commands.

**Three phases, two prompts, one loop** (how-to-ralph-wiggum / Clayton Farr's
ralph-playbook, https://github.com/ClaytonFarr/ralph-playbook):
1. Requirements (human+LLM → specs), 2. Planning loop (gap analysis specs-vs-code →
prioritized plan; "Plan only. Do NOT implement anything"), 3. Building loop (one task per
iteration; update plan; commit; push).

**One item per loop.** Despite ~170–176K usable tokens, each iteration does exactly one
discrete task, targeting 40–60% "smart zone" context utilization. One iteration = one
task = one commit.

**Signs / guardrails accumulation.** Steering is done by *appending* guardrails ("signs")
rather than rewriting the prompt. Examples: "Before making changes search codebase (don't
assume not implemented)", "DO NOT IMPLEMENT PLACEHOLDER OR SIMPLE IMPLEMENTATIONS",
"capture the why" in test docstrings. Guardrails sit at the end of the prompt with
9s-sequence numbering (999, 9999, 99999…) — higher = more critical.

**Subagent fan-out.** Main agent acts as a scheduler; expensive reads/searches fan out to
parallel subagents; crucially **only 1 subagent for build/test** — the deliberate
backpressure bottleneck.

**Backpressure.** Deterministic feedback that rejects fake progress: tests, typecheck,
lint, build (commands recorded in AGENTS.md); acceptance-criteria-derived tests written
during planning; LLM-as-judge (binary pass/fail) for subjective criteria. "All required
tests must exist and pass before the task is considered complete."

**Completion.** No hard completion detection in the original — the loop is infinite; you
observe. ~90% completion claimed on **greenfield only**; brownfield breaks the approach.

## 2. Open-Source Implementations — What They Add Beyond the Naive While-Loop

### snarktank/ralph (Ryan Carson) — PRD-driven, minimal
https://github.com/snarktank/ralph
- Bash loop, default **max 10 iterations**, 2s sleep between.
- **State files:** `prd.json` (user stories, each with `passes: false/true`, priority,
  branchName), `progress.txt` (append-only log), `archive/` (auto-archives prior runs).
- **Per-iteration protocol (CLAUDE.md):** read prd.json + progress.txt (Codebase Patterns
  section first) → pick highest-priority `passes: false` story → implement only that
  story → run typecheck/lint/test (all must pass) → update CLAUDE.md with genuinely
  reusable patterns only → commit `feat: [ID] - [Title]` → set `passes: true` → append
  progress entry with "Learnings for future iterations".
- **Memory promotion:** a "Codebase Patterns" section at the top of progress.txt
  consolidates reusable insights, separate from story-specific log entries.
- **Completion detection:** agent emits `<promise>COMPLETE</promise>` only when ALL
  stories pass; harness greps output for it. Exit 0 on signal, **exit 1** after
  exhausting MAX_ITERATIONS.

### mikeyobrien/ralph-orchestrator — hats/personas, events, gates (Rust)
https://github.com/mikeyobrien/ralph-orchestrator
- **Hat/role rotation:** specialized personas coordinating via events; presets:
  `code-assist` (Planner→Builder→Validator→Committer), `debug`, `research`, `review`.
  `human.interact` events block for human-in-the-loop. (Pattern also in
  https://github.com/samfoy/pi-ralph: hats in YAML; agent emits `>>> EVENT: name`.)
- **Phase separation:** `ralph plan` generates `requirements.md`, `design.md`,
  `implementation-plan.md`; `ralph run` executes the loop.
- **Completion:** `LOOP_COMPLETE` promise string; also `- [x] TASK_COMPLETE` checkbox.
- **Thrash detection:** stops when agent output is **≥90% fuzzy-similar to any of the
  last 5 outputs**.
- **Layered budgets:** iterations (default 100), runtime (4h), cost ($10), consecutive
  failures (5), similarity threshold (90%).
- **Persistence:** git checkpoints, prompt archives, metrics store; retries with backoff;
  backpressure gates. Backends: Claude Code, Gemini CLI, Codex, Amp, Copilot CLI, etc.

### frankbria/ralph-claude-code — exit gating + circuit breaker
https://github.com/frankbria/ralph-claude-code
- **Dual-condition exit gate:** requires ≥2 natural-language completion indicators **AND**
  an explicit `EXIT_SIGNAL: true` from the agent — prevents premature exit.
- **Circuit breaker:** opens after 3 loops with no progress or 5 loops with identical
  errors; OPEN → HALF_OPEN → CLOSED auto-recovery after cooldown (default 30 min).
- **Rate/cost limits:** 100 API calls/hour default, optional MAX_TOKENS_PER_HOUR.
- Files: `.ralph/PROMPT.md`, `.ralph/fix_plan.md` (unchecked items block exit),
  `.ralph/AGENT.md` (auto-maintained build/test commands), `.ralphrc`, rotating logs.

### umputun/ralphex — phase pipeline + adversarial review
https://github.com/umputun/ralphex
- **Four phases:** task execution → first review (**5 parallel reviewer agents**) →
  optional external review (Codex or custom script — a *different vendor* as verifier) →
  final review (critical/major only).
- **Plan format is machine-parsed:** `### Task N:` headers, checkboxes only inside task
  sections, a `## Validation Commands` section run after each task to gate advancement.
- **Stops:** all boxes checked; max-iterations (default 50) per phase; **stalemate
  detection** (N consecutive review rounds with no commits/tree changes); timeouts.
- **Resume:** re-running on the same plan continues from first unchecked task; completed
  plans archived; each task = one commit; SIGQUIT pauses for mid-run plan edits.

### vercel-labs/ralph-loop-agent — programmatic verification callback
https://github.com/vercel-labs/ralph-loop-agent
- TS wrapper: outer Ralph loop around the inner tool loop.
  `verifyCompletion({result, iteration, allResults, originalPrompt}) → {complete, reason}`
  — the **harness owns completion**, and the `reason` for `complete: false` is injected
  as feedback into the next iteration.
- Stop conditions composable with OR: `iterationCountIs(n)`, `tokenCountIs(n)`,
  `costIs(maxCost)`. Result carries
  `completionReason: 'verified' | 'max-iterations' | 'aborted'`.

### Anthropic's official ralph-wiggum plugin for Claude Code
https://github.com/anthropics/claude-code/tree/main/plugins/ralph-wiggum
- `/ralph-loop "<prompt>" --max-iterations <n> --completion-promise "<text>"`.
  Implemented as a **Stop hook** that blocks session exit and re-feeds the same prompt
  in-session. Promise is **exact string match**; `--max-iterations` is "your primary
  safety mechanism."

### Others
- `Th0rgal/open-ralph-wiggum`, `iannuttall/ralph`, `mj-meyer/choo-choo-ralph`,
  `subsy/ralph-tui`, `rubenmarcus/ralph-starter` (tracker integrations + cost tracking).
- Token-health states (🟢<60%, 🟡60–80% wrap up, 🔴>80% forced rotation) and "gutter
  detection" (same command failed 3×, file thrashing) — agrimsingh/ralph-wiggum-cursor,
  https://dev.to/alexandergekov/2026-the-year-of-the-ralph-loop-agent-1gkj
- **guardrails.md spec** (https://guardrails.md/): formalizes the Signs file — each Sign =
  **Trigger / Instruction / Reason / Provenance**; auto-append on 3+ identical errors,
  circular tool-call loops, or manual intervention; config
  `{path: .ralph/GUARDRAILS.md, auto_append: true, trigger_threshold: 3}`; context
  rotation at >80% capacity; per-iteration tool-call rate caps.
- Curated list: https://github.com/snwfdhmp/awesome-ralph

## 3. Claude Code `/goal` and Anthropic Harness Guidance

### `/goal` (built-in goal loop) — https://code.claude.com/docs/en/goal
- `/goal <condition>` sets a completion condition (≤4,000 chars) and starts a turn.
- **Mechanism:** a session-scoped **prompt-based Stop hook**. After every turn, the
  condition + full conversation go to a **small fast model (default Haiku)** — a fresh
  evaluator, deliberately *not* the model doing the work. It returns yes/no + a short
  reason; "no" starts another turn with the reason injected as guidance; "yes" clears
  the goal.
- **Evaluator limits:** it calls no tools and reads no files — it judges only what the
  agent surfaced in the transcript. So conditions must be *demonstrable in output*: "one
  measurable end state, a stated check (`npm test` exits 0), and constraints that must
  not change." Bounding is done in-condition ("or stop after 20 turns").
- Non-interactive: `claude -p "/goal <condition>"` runs the loop to completion.

### Anthropic: "Effective harnesses for long-running agents"
https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents
- Two-agent harness: **initializer agent** (first session: creates `init.sh`,
  `claude-progress.txt`, feature-list JSON, initial commit) + **coding agent** (every
  later session: incremental progress, leaves repo "production-ready").
- **Feature list as JSON, not Markdown** — entries `{category, description, steps,
  passes: false}`; agents may only flip `passes`; "It is unacceptable to remove or edit
  tests." JSON chosen because models tamper less with structured data.
- **Full context resets beat compaction**: tear down the session and rebuild from
  structured handoff files (progress file + git log).
- **Session protocol:** pwd → read git log + progress → pick highest-priority failing
  feature → run `init.sh` → smoke-test *before* new work → implement one feature →
  verify via **browser automation + screenshots** → flip `passes` only after
  verification → commit + update progress.
- **Named failure modes:** premature victory declaration; one-shotting; marking features
  complete without testing; undocumented broken handoffs; wasting tokens rediscovering
  setup.

### Anthropic: "Harness design for long-running application development"
https://www.anthropic.com/engineering/harness-design-long-running-apps
- Three-agent evolution: **Planner** → **Generator** → **Evaluator** (drives the live app
  via Playwright MCP, screenshots, grades against hard per-criterion thresholds).
- **Sprint contract:** generator and evaluator negotiate testable "done" criteria in
  shared files *before* coding. Agents communicate through files, not conversation.
- **Lessons:** harness components encode assumptions that go stale as models improve;
  "making generators self-critical proved difficult, but tuning a standalone evaluator to
  be skeptical turns out to be far more tractable"; the evaluator pays off only when the
  task sits beyond what the model does reliably solo.
- Repo: https://github.com/anthropics/cwc-long-running-agents

## 4. 2026 Consensus Checklist — sophisticated vs naive (NORMATIVE for spec §6)

1. **Fresh context per iteration + durable files as the only memory.** (Huntley;
   snarktank; Anthropic "full context resets" > compaction; Osmani.)
2. **Machine-verifiable finish line, re-verified by the harness — never trusted from the
   model.** Guard against "premature victory declaration". (vercel-labs verifyCompletion;
   /goal's separate evaluator; ralphex validation commands; frankbria dual-condition gate.)
3. **Plan file as a priority queue with per-item pass/fail state.** JSON preferred over
   Markdown to deter tampering; only `passes` is mutable; plan is regenerable/disposable.
   (Huntley; snarktank; Anthropic; ralphex.)
4. **One item per iteration = one commit.** (Huntley; snarktank; Anthropic "one-shotting".)
5. **Guardrails/signs file that accumulates learnings.** Sign = Trigger/Instruction/
   Reason/Provenance; auto-append on repeated failure (threshold 3). (Huntley;
   guardrails.md; snarktank learnings/patterns promotion.)
6. **Backpressure gates before any completion claim.** Typecheck/lint/test/build per
   task; commands recorded in AGENTS.md; tests may not be deleted/edited to pass; e2e/
   browser verification for UI. (Huntley pressure; ralph-orchestrator; Anthropic.)
7. **Thrash / stall detection.** Output-similarity (≥90% vs last 5); circuit breaker on
   3 no-progress loops / 5 identical-error loops; stalemate = N rounds with no commits or
   tree changes; gutter detection. (ralph-orchestrator; frankbria; ralphex.)
8. **Layered budget stop rules, OR-combined.** Max iterations / wall-clock / cost /
   tokens / consecutive failures / idle timeouts. (ralph-orchestrator; vercel-labs;
   frankbria; ralphex.)
9. **Phase separation: plan / build / verify.** Separate planning loop ("Plan only, do
   NOT implement") from building loop; review phases after build. (ralph-playbook;
   ralph-orchestrator; ralphex; Anthropic planner/generator/evaluator.)
10. **Verifier separate from builder.** Fresh, skeptical evaluator (different session,
    smaller model, different vendor, or browser-driving agent); pre-negotiated testable
    criteria (sprint contract). (Anthropic; /goal Haiku evaluator; ralphex Codex review.)
11. **Failure-feedback injection.** The verification-failure *reason* becomes the next
    iteration's directive. (vercel-labs; /goal; ralphex.)
12. **Progress log + session-start orientation protocol.** Append-only progress file with
    learnings; fixed startup ritual: read git log + progress → run init → smoke-test
    before new work. (snarktank; Anthropic.)
13. **Resumability & archiving.** Continue from first incomplete item on restart; archive
    runs; git checkpoints. (ralphex; snarktank; ralph-orchestrator.)
14. **Distinct exit codes / completion reasons.** `verified | max-iterations | aborted`;
    exit 0 on verified vs 1 on budget exhaustion. (vercel-labs; snarktank.)
15. **Subagent fan-out for reads, single-threaded writes/tests.** (Huntley.)
16. **Optional hat/role rotation via events** for multi-step pipelines.
    (ralph-orchestrator; pi-ralph.)
17. **Scope discipline:** best for greenfield/spec-driven, machine-checkable work; spec
    quality dominates outcome quality. (Huntley; HumanLayer.)

Note: `frison/ralph` does not exist on GitHub; the features often attributed to it live
in mikeyobrien/ralph-orchestrator, samfoy/pi-ralph, and the guardrails.md spec.
