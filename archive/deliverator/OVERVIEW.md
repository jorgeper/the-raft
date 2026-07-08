# How Deliverator Works

*Read this first, cover to cover — it's the education. When you're done, the
[README](README.md) installs it and [LABS.md](LABS.md) puts your hands on the
wheel.*

```text
        you ──▸ issue ──▸ ┌──────────────────┐ ──▸ reviewed PR ──▸ you
                          │   DELIVERATOR    │
                          │  the loop never  │
                          │      sleeps      │
                          └──────────────────┘
```

---

## The promise

Here is the whole system in one sentence: **a daemon watches GitHub for issues
you've labeled `agent:ready`, moves each one through a fixed pipeline —
design → design review → your sign-off → code → code review → your sign-off →
merge — and every role is a Claude Code agent whose tools, prompt, and model
you dial per role.**

You write briefs and make judgment calls at three gates. Agents do everything
else: draft the design, critique it, write the code, test it, re-verify it in
a sandbox, review it from two independent angles, and hand you a pull request
with the evidence attached. If it's good, you merge it. If it's not, you say
*why* in one comment and send it back around.

That's not a metaphor. That's the actual operating procedure, and by the end
of this document you'll know exactly how each piece works and — more
importantly — why it's shaped the way it is.

## Why this exists

Working with a coding agent interactively is powerful but it consumes *you*:
you're the memory, the router, the reviewer, and the babysitter, one session
at a time. The interesting question is what it takes to step back — to run
development the way a good engineering lead runs a team: set direction,
review at the right moments, never type the code yourself.

The answer turns out to be mostly *not* AI. It's process engineering:

- a **work queue** that survives crashes,
- a **state machine** with explicit human gates,
- **workers with narrow jobs** and narrow permissions,
- **verification nobody can grade themselves on**, and
- **guardrails enforced somewhere the model can't negotiate**.

Deliverator is those five things, wrapped around whatever project you point it
at. The intelligence lives in the model calls; the *control* lives in ~300
lines of Python you can read in five minutes.

## Three design principles

Everything else in this document traces back to one of these.

### 1. State lives in GitHub, not in any process

An issue's label — `agent:coding`, `agent:needs-human` — *is* its state. The
orchestrator holds nothing in memory worth keeping: kill it mid-run, restart
it tomorrow, move it to a different machine; the next pass re-reads reality
from GitHub and picks up exactly where things stood.

This one decision buys a surprising amount:

- **Durability for free.** No database, no recovery logic. GitHub is the
  database.
- **A UI for free.** The issues list, filtered by label, is your dashboard.
  Green means ready to advance, yellow means design, blue means code, red
  means waiting on you, purple means done.
- **An audit log for free.** Every label flip and agent comment lands in the
  issue timeline, timestamped. You can reconstruct any run after the fact.
- **Steering from anywhere.** Anything that can flip a label is a control
  surface: your terminal, or the GitHub app on your phone.

### 2. You steer at exactly three points

```text
 ◆ TOUCH POINT 1            (hands-off middle)              ◆ TOUCH POINT 3
 shape the brief,     ┌───────────────────────────┐      validate for real,
 iterate the design,  │  code · verify · review   │      approve & merge —
 arbitrate reviews    │   you watch, you don't    │      or bounce it back
                      │          type             │      with a repro
                      └───────────────────────────┘
                          ▲ TOUCH POINT 2 = restraint
```

Human effort is deliberately **front-loaded**: a design flaw caught at touch
point 1 costs you a PR comment; the same flaw caught after implementation
costs a full re-run. So the design phase is where you spend rounds, and by
touch point 3 you're *verifying*, not designing.

Machine effort is deliberately **back-loaded**: the expensive model work
(writing code) only happens after a human-approved, twice-reviewed design.
The loop never burns coder tokens on a bad plan.

And touch point 2 is a real skill: resisting the urge to jump in while the
middle runs is the discipline that lets one person operate several loops at
once.

### 3. Nothing certifies its own work

The coder says "tests are green." So what? It *wrote* those tests, in the same
session, with every incentive to believe itself. Deliverator treats every
claim as unverified until someone with no stake confirms it:

```text
 coder ──▸ Docker re-check ──▸ CI ──▸ reviewer A ──▸ reviewer B ──▸ you
 (wrote      (network-less      (clean    (different     (different    (runs the
  the code)   container the      VM)       model          model         real app)
              coder can't                  family)        family)
              influence)
```

Each layer catches what the layer before missed. The coder's tests can be
wrong; the sandbox can't check that the feature makes sense; CI can't click
through a login flow. Only the last verifier — you, running the actual app —
closes the loop. Layered, mutually distrustful verification is what makes the
autonomy safe.

---

## The anatomy

Five components, top to bottom. Each exists to solve one specific problem.

```text
┌────────────────────────────────────────────────────────────────┐
│ ◆ YOU — the product owner                                      │
│   briefs · design steering · arbitration · final validation    │
│   (you never type application code)                            │
└──────────────┬─────────────────────────────────────────────────┘
               │ issues · PR comments · label flips
┌──────────────▼─────────────────────────────────────────────────┐
│ GITHUB — the source of truth                                   │
│   issues = work queue    labels = state machine                │
│   PRs = review surface   Actions = outer loop                  │
└──────────────┬─────────────────────────────────────────────────┘
               │ polled every 30s, by label
┌──────────────▼─────────────────────────────────────────────────┐
│ ORCHESTRATOR — the control plane (loop.py + friends)           │
│   deterministic Python · no AI inside · one state per pass     │
│   memos · worktrees · timeouts · tmux viewport                 │
└──────────────┬─────────────────────────────────────────────────┘
               │ one stage handler per state
┌──────────────▼─────────────────────────────────────────────────┐
│ ROLE AGENTS — the workers                                      │
│   designer · design reviewers ×2 ·                             │
│   coder · code reviewers ×2                                    │
│   each = an agent file (.claude/agents/<role>.md): prompt +    │
│   tools + model · fresh-context claude -p run · never resumed  │
└──────────────┬─────────────────────────────────────────────────┘
               │ time-bounded headless runs
┌──────────────▼─────────────────────────────────────────────────┐
│ CLAUDE CODE — one engine for every role                        │
│   native skills · hooks (file protection, Stop gate) ·         │
│   per-role tool allowlists · one Anthropic login               │
└────────────────────────────────────────────────────────────────┘
```

**Why a dumb orchestrator and smart workers?** The Python daemon makes no
decisions about *content* — it only routes: which issue, which stage, which
model, when to stop. When something behaves weirdly, you always know which of
two places to debug: a handler (deterministic code — read it) or a model call
(open the memo and see exactly what the model was given and what it said).

**Why roles instead of one super-agent?** Three reasons. Cheaper routing — a
review is a smaller job than writing code, so it gets a cheaper model. Sharper
prompts — each role has one job and one output contract. And *independent
judgment* — the reviewer never saw the coder's reasoning, so it judges the
artifact, not the intention.

**Why worktrees?** Each issue gets a private git checkout (`worktrees/issue-N`,
on branch `agent/issue-N`) sharing the repo's object database. Two issues in
flight can't clobber each other, and a misbehaving coder can't touch your main
checkout. Near-instant, nearly free — it's built into git.

## The state machine

The entire workflow is a label-to-handler table. This is the part to
internalize; everything you do day-to-day is moving issues along these edges.

```text
                            you file a brief
                                  │
                            agent:ready
                                  │
                    ┌─────────────▼──────────────┐
              ┌────▸│  design agent drafts       │
              │     │  DESIGN.md → design PR     │
              │     └─────────────┬──────────────┘
   agent:design-draft             │
   (you: "revise")          agent:needs-human ◆ TOUCH POINT 1
              │                   │
              └───────────────────┤  you comment & relabel … or approve:
                                  │
                        agent:design-approved
                                  │
                    ┌─────────────▼──────────────┐
                    │  design reviewers ×2       │
                    │  feasibility + security    │
                    └─────────────┬──────────────┘
                                  │
                            agent:needs-human ◆ you arbitrate
                                  │
                            agent:coding ◂──────────── agent:trivial
                                  │                    (bug fixes skip
                    ┌─────────────▼──────────────┐      design entirely)
              ┌────▸│  coder (Claude Code) in    │
              │     │  the worktree, until green │
              │     └─────────────┬──────────────┘
   still red? stays               │
   in agent:coding,         ┌─────▼──────────────┐
   error in the memo ◂──────│  Docker re-check   │ ✗
              │             │  (--network none)  │
              │             └─────┬──────────────┘ ✓
              │                   │
              │             push → implementation PR → CI runs
              │                   │
              │             agent:code-review
              │                   │
              │     ┌─────────────▼──────────────┐
              │     │  code reviewers ×2         │
              │     │  correctness + security    │
              │     └─────────────┬──────────────┘
              │                   │
              │             agent:needs-human ◆ TOUCH POINT 3
              │                   │
              └── "here's a repro"┤  you run it for real, then:
                                  │
                        approve · merge · agent:done · release fires
```

Rules that keep it sane: exactly **one `agent:*` stage label per issue** at a
time; moving the label *is* the state transition; and the loop advances each
issue **one state per pass** — so a bug can't spiral an issue through the
whole pipeline in seconds, and a crash never loses more than a step.

Want a new stage? Add a label, write a handler, add one row to the `STAGES`
table in `loop.py`. That table *is* the workflow.

## The three loops

"Agentic loop" is really three loops nested inside each other, each with its
own cadence, its own verifier, and its own failure response. Knowing which
loop you're in at any moment is most of understanding the system.

```text
┌─ LOOP 3 · THE STEERING LOOP — you ──────────────── hours→days ─┐
│  brief → design rounds → approve → (wait) → validate → merge   │
│  verifier: your judgment, running the real app                 │
│  on failure: a precise comment + a label flip — never a        │
│              hand-edit                                         │
│                                                                │
│  ┌─ LOOP 2 · THE OUTER LOOP — CI on every PR ──── minutes ─┐   │
│  │  PR opened → clean VM → install → lint → test →         │   │
│  │  green check or red X · release on merge                │   │
│  │  verifier: a fresh environment that trusts no laptop    │   │
│  │                                                         │   │
│  │  ┌─ LOOP 1 · THE INNER LOOP — the coder ── seconds ─┐   │   │
│  │  │                                                  │   │   │
│  │  │   edit → make lint && make test → read the       │   │   │
│  │  │   failure → fix → ↺ … until green                │   │   │
│  │  │                                                  │   │   │
│  │  └──────────────────────────────────────────────────┘   │   │
│  └─────────────────────────────────────────────────────────┘   │
└────────────────────────────────────────────────────────────────┘
```

**Speed lives inside; trust lives outside.** The inner loop is fast and runs
on the coder's own word. The outer loop is slower but runs on a machine nobody
configured by hand. Your loop is slowest and carries the authority.

**The coder must live inside loop 1.** A coder that can see a failing test and
fix it in seconds beats one that gets a single blind attempt per pass. This is
why the coder runs on a real harness — Claude Code headless, with file access
and the ability to run commands — rather than a bare completion call. The
quality of the whole system tracks the tightness of its tightest feedback
loop — and a Stop-hook gate re-runs lint+tests whenever the coder tries to
finish, so "done" is checked mechanically, not taken on faith.

**Bounce-backs are loop 3 doing its job.** When you return a PR with a repro
instead of fixing it yourself, the failure feeds loop 1's next cycle *and* the
issue's memo — the fix and the lesson both land inside the system instead of
in your working memory.

## How agents know things

Model calls are stateless — every call starts from nothing. All continuity is
text the orchestrator hands over at call time, and the art is in *when* each
kind of knowledge loads:

```text
                        always loaded          loaded on demand
                    ┌───────────────────┬─────────────────────────┐
 whole repo         │  AGENTS.md        │  skills                 │
 (every agent)      │  (conventions,    │  (.claude/skills/*/     │
                    │   commands,       │   SKILL.md — procedures │
                    │   do-not-touch)   │   that fire on match)   │
                    ├───────────────────┼─────────────────────────┤
 one issue          │  the memo         │                         │
 (this task only)   │  (memory/issue-N  │                         │
                    │   .md — spec,     │                         │
                    │   reviews, errors)│                         │
                    └───────────────────┴─────────────────────────┘
```

The discipline that makes this work: **always-loaded things stay tiny;
everything conditional becomes a skill.** A bloated always-on file is a tax
paid on every call by every agent — in tokens, in dollars, and in attention
(models follow instructions worse as instruction volume grows). A skill splits
the cost: its one-line *description* is always visible (~30 tokens); its full
*body* loads only when a task matches. That split is called **progressive
disclosure**, and it's why you can install twenty skills and pay for none of
them until the moment one is needed.

Deliverator ships five: `design-doc` (the DESIGN.md structure), a stack
conventions skill (`flask-conventions` by default — swap for yours),
`run-inner-loop` (the validation sequence), `acceptance-criteria-audit` (prove
every criterion has a test), and `oauth-security-checklist` (fires whenever
auth is in scope).

Why files rather than some vector database? Because files are **debuggable**:
when an agent behaves oddly, you open the exact text it saw. Boring,
inspectable, versionable memory wins at this scale. The same logic puts the
per-issue memo in a markdown file: when the coder "knows" what the design
reviewers said, it's because those reviews sit in `memory/issue-N.md` and got
pasted into its prompt. You can read precisely what it read.

## Trust is enforced, not requested

"Never touch `.env`" written in AGENTS.md is a *request* to a language model —
usually honored, never guaranteed. So every rule that matters is also enforced
mechanically, somewhere the model can't negotiate:

| Guardrail | Mechanism | What it stops |
|---|---|---|
| Human gates | issues park at `agent:needs-human`; only a label flip proceeds | anything merging without you |
| Tool allowlist | coder may run `make`, `pytest`, `git commit` — not `curl`, not `pip install`, not `git push` | escapes and surprises on your machine |
| Hooks | a separate OS process vets every file edit; exit code 2 blocks it | edits to `.env`, keys, migrations — regardless of what the model decides |
| Sandboxes | validation re-runs in a Docker container with **no network**, seeing only the worktree | hallucinated dependencies phoning home; host contamination |
| Stop gate | a Stop hook re-runs `make lint`/`make test` when the coder tries to finish; a red build blocks the turn | "done" claims on a red build |
| Runaway guards | every role run is bounded by a wall-clock timeout (`ROLE_TIMEOUT`, `CODER_TIMEOUT`) | a stuck run holding the loop hostage |
| Least privilege | reviewers get read-only everything; only the coder writes | a reviewer "helpfully" rewriting the code it judges |
| One step per pass | the loop advances each issue a single state per pass | a bug spiraling through the pipeline in seconds |

Notice the pattern: every guardrail lives *outside* the model — in the
harness, the OS, the provider, or GitHub. **Enforcement beats instruction.**
That's the rule to carry into anything you build on top of this.

Reviewer trust gets two extra tricks. **Isolation:** reviewers run in fresh
contexts as separate processes — they never see the coder's reasoning, only
the artifact, so they judge what was built, not what was intended. **Tools:**
a reviewer that runs `git diff` itself, greps callers, and checks acceptance
criteria against real files catches more than one reading a prose summary.
The reviewer pairs also split by tier and lens (haiku + opus, correctness +
security), and the layers that can't share blind spots with any model — the
network-less Docker re-check and CI — sit between coder and merge either way.

## Models

Each role's default model lives in its agent file: `sonnet` for the designer
and coder (the hardest work), `haiku` and `opus` for the reviewer pairs
(different tiers, different lenses). Override any role with a `MODEL_<ROLE>`
line in `.env` — upgrade only roles that visibly fail, in order of cost:
sharpen the skill, then the prompt, then the model.

There is deliberately no spend machinery — no budget caps, no cost ledger, no
dashboard. Every run rides your Claude login, and the runaway guards are
mechanical instead of financial: wall-clock timeouts per run, the Stop gate,
and the one-state-per-pass rule.

## The life of one feature

Putting it all together — every step leaves a durable trace in GitHub, which
is what makes a run auditable after the fact. ◆ marks your moves:

```text
 1 ◆ you file a brief ................................. issue #42, agent:ready
 2   design agent drafts DESIGN.md .................... design PR
 3 ◆ you push back in PR comments, relabel ............ as many rounds as needed
 4 ◆ you approve the design PR ........................ agent:design-approved
 5   two design reviewers critique .................... comments on #42
 6 ◆ you arbitrate: real concern → step 2; noise → .... agent:coding
 7   coder implements in the worktree until green ..... commits
 8   Docker re-check → push → implementation PR ....... CI runs
 9   two code reviewers cross-examine ................. reviews on the PR
10 ◆ you check CI, read reviews, RUN THE APP, merge ... release fires
```

A **brief** (step 1) is the input skill worth practicing: it fixes the *what* —
behavior, constraints, what "done" means — and leaves the *how* open. Too
loose and the design phase wanders; too tight and touch point 1 is theater.
Bug fixes skip the ceremony entirely: label them `agent:trivial` and they go
straight to step 7.

When something keeps going wrong, **correct the system, not the code**: a
review gap becomes a comment (it feeds the memo), a recurring class of gap
becomes a line in AGENTS.md, a chronically weak reviewer gets a better model —
a `MODEL_<ROLE>` line in `.env`. In that order of cost. The loop improves by editing
its parts, not by you doing its job.

## What Deliverator is not

Honesty before you commit an afternoon to installing it:

- **It's not autonomous end-to-end.** It's semi-autonomous on purpose. The
  gates are the feature, not a limitation — remove them and you've built a
  machine for merging plausible-looking code you've never run.
- **It's not going to one-shot a complex app.** It will get impressively far
  on well-briefed, well-scoped issues, and it will fail in instructive ways on
  vague ones. The failure mode is your steering improving, which is the point.
- **It's not locked to any of its parts.** The coder is a pluggable stage
  (Claude Code today, anything with a CLI tomorrow); reviewers are one-line
  model swaps; skills are an open standard readable by other harnesses; and
  the whole control plane is plain Python in your repo. No part of it is
  load-bearing magic.

The loop is the product. Keep the leash exactly as long as your verifiers are
strong — and when in doubt, add a verifier, not autonomy.

---

**Educated. Now install it: [README.md](README.md) → then drive it:
[LABS.md](LABS.md).**
