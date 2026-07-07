# Lab 6 — Extend the studio

Goal: grow the system along both of its extension axes — add a **third reviewer**
with a security lens, and start a **new tracker backend** against the interface,
test-first. Time: ~40 minutes. Uses:
[trackers](../architecture/03-trackers-and-work-items.md) and
[agents](../architecture/04-agents-skills-runtimes.md).

## Part A — a security reviewer

Two reviewers on different models catch each other's blind spots; a third with a
*different mandate* catches what both miss when neither was looking for it.

### A1. The role prompt

```sh
cat > prompts/security-reviewer.md <<'EOF'
# Security reviewer agent

## Role
You are the security reviewer. You review ONLY for security: trust boundaries,
injection, authn/authz, secrets, unsafe defaults, dependency risk. Correctness and
style belong to the other reviewers — stay in your lane.

## Output contract
Findings classified [BLOCKER]/[SUGGESTION]/[NIT], each with evidence you produced
(a command, a payload, a line). End with exactly one line:
`VERDICT: APPROVE` or `VERDICT: CHANGES`.

## NEVER
- Never approve because the other reviewers did — you review independently.
- Never report a hypothetical without attempting it: try the injection, then report.
- Never edit code, merge, or change item state.

## Stop rule
Cannot check out the branch or find the design spec in the comments →
`NEEDS_HUMAN: <what is blocking>` and nothing else.

## Memory
Read your journal (in the task context); append recurring vulnerability patterns to
memory/reviewer/journal.md after each review.
EOF
```

### A2. Wire it, require three approvals

`config/studio.yaml`:

```yaml
approvals_required: 3
agents:
  # ...existing...
  reviewer-sec:
    runtime: claude
    prompt: prompts/security-reviewer.md
    skills: [code-review-rubric]
    handles: pr:agent-review
    memory: reviewer
```

```sh
python -m studio init
```

Checkpoint: init lists `reviewer-sec: runtime=claude (ok) handles=pr:agent-review`
and `.claude/agents/studio-reviewer-sec.md` now exists with your prompt as its body.

### A3. See the round pick it up

```sh
touch .work/items/.keep 2>/dev/null; python -m studio new "probe item" --body "x"
# walk it to review state for the dry-run (markdown tracker: edit the state field
# in .work/items/1.md to pr:agent-review), then:
python -m studio run --dry-run --once
```

Checkpoint: the dry-run line names the review round with all three reviewers. The
orchestrator needed **zero changes**: review rounds run *every* agent handling
`pr:agent-review`, and unanimous-approval logic already reads "all verdicts", not
"both" ([orchestrator](../architecture/06-orchestrator-and-safety.md)). Delete the
probe item afterwards (`rm .work/items/1.md`).

Cost note: three reviewers per round is real money on real models. The lens
specialization is the justification — if security findings stay rare after a month,
drop back to two and keep the prompt for security-sensitive items only.

## Part B — a Linear tracker, test-first

The repo ships this lab's answer: `studio/tracker/linear.py` (a working in-memory
stub with the GraphQL call sites marked) and `tests/test_tracker_linear.py` (the
contract test). Work through them in this order:

### B1. Read the contract test first

```sh
cat tests/test_tracker_linear.py
.venv/bin/python -m pytest tests/test_tracker_linear.py -v
```

Checkpoint: 5 tests pass. Read what they pin: ABC satisfaction, CRUD + filters,
comment round-trip, **transition validating through the shared state machine** (the
human gate holds even in a stub!), and single-flight claims. This is the definition
of "is a tracker" — every backend, real or stub, passes exactly this shape of test.

### B2. Read the stub's seams

`studio/tracker/linear.py` has one `_api()` method — the single place GraphQL
requests will go — and comments marking each call site (`issueCreate`,
`issueUpdate`, `commentCreate`). The in-memory dict stands in for Linear's server;
making it real is replacing storage, not logic. Note what the stub *refused* to
simplify: `check_transition` runs on every transition. State-machine rules live in
one module and every backend inherits them — that invariant is the whole point.

### B3. Wire the factory (when you go real)

```python
# studio/tracker/__init__.py — make_tracker gains one branch:
if cfg.tracker.kind == "linear":
    return LinearTracker(cfg.tracker.repo)
```

Plus one line in `studio/config.py` accepting `kind: linear`, and config becomes
`tracker: {kind: linear, repo: TEAM}`. The orchestrator, loop, CLI, and state
machine need nothing — they speak Tracker, not GitHub.

## What you learned

- Review rounds scale by config: a new reviewer is a prompt + a yaml entry +
  `studio init`; unanimity logic and degraded mode already generalize.
- Specialized lenses beat redundant generalists — and cost is a design input, so
  measure whether the third lens earns its tokens.
- A tracker backend is defined by its contract test; write (or copy) the test
  before the implementation.
- `check_transition` in every backend is the invariant that makes backends
  interchangeable — storage varies, rules don't.
- The extension points were load-bearing all along: nothing in this lab touched the
  orchestrator or the loop.

---

[← Lab 5: Teach the team](05-teach-the-team.md) · [Index](../README.md) ·
[Back to Part 1 concepts](../concepts/01-from-prompts-to-loops.md)
