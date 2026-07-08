# Proposal: Deliverator v2 — pure Claude Code

**Status:** IMPLEMENTED 2026-07-04 (all decisions resolved: design PR kept, models via .env `MODEL_<ROLE>` overrides, all human gates kept, Telegram deleted). One deviation from the draft: the CLI dropped `--max-turns`, so the runaway guard is wall-clock timeouts (`ROLE_TIMEOUT`/`CODER_TIMEOUT`) instead of turn caps · **Author:** Claude (with jorgeper) · **Date:** 2026-07-04

Deliverator currently splits its brain: the coder runs on Claude Code headless
(and gets tools, skills, and an inner loop), while the design agent and all
four reviewers are bare OpenRouter completion calls that can't read the repo,
run a test, or load a skill natively. Around that split we hand-rolled a skill
loader, a cost ledger, per-role capped keys, and a model-routing layer.

This proposal deletes the second brain. **Every role becomes a fresh-context
Claude Code run** with role-appropriate tools, native skills, and a
verification-gated loop. The orchestrator shrinks to what it always wanted to
be: a label poller that dispatches `claude -p` and enforces gates. All cost
machinery goes away.

---

## 1. What stays (the invariants)

Nothing in this proposal touches the four properties that make Deliverator
Deliverator:

1. **GitHub labels are the only workflow state.** Kill the loop any time;
   restart resumes from labels.
2. **Agents are stateless; memory is files** (memos, DESIGN.md, issue
   comments) — this is *also* the current industry best practice for agent
   loops ("fresh context per iteration"), so v2 leans into it harder rather
   than abandoning it.
3. **Nothing certifies its own work.** Coder → Docker re-check → CI →
   reviewers in fresh contexts → you.
4. **Human gates are unchanged.** Every `agent:needs-human` touch point stays.

Also kept as-is: per-issue git worktrees, the memo layer, the Docker sandbox
re-check, the state machine table, `MAX_PARALLEL` issue concurrency, and the
tmux live viewport (which now shows *every* role, not just the coder).

## 2. What gets deleted

| Deleted | Why it existed | Replaced by |
|---|---|---|
| `llm.py` (OpenRouter client, cost ledger, locks) | route non-coder roles + track spend | `claude -p` for every role; no spend tracking |
| `agents/roles.py` (prompt+model dicts) | roles for completion calls | `.claude/roles/*.md` files (§4) |
| `skills.py` (keyword-trigger skill loader) | completion roles can't load skills | native `.claude/skills/` progressive disclosure in every run |
| `provision_keys.py`, `role_keys.json` | per-role budget-capped keys | gone (no cost stuff) |
| `check_models.py` | OpenRouter slug drift | gone (model names are `--model sonnet` etc.) |
| `dashboard.py`, `logs/costs.csv` | spend visibility | gone; `claude` JSON results still report cost if you ever care |
| `MAX_USD_PER_RUN` cap + soft-cap logic | runaway-spend guard | per-role wall-clock timeouts as the runaway guard (§6) |
| `bot.py` (Telegram) | phone steering | GitHub mobile app (labels + comments are already the full steering vocabulary) — **decided: delete** |
| `CODER_MODE=oneshot` | demo of life without a harness | gone — the whole system is the harness now |
| deps: `openai`, `httpx`, `pydantic` | OpenRouter/Telegram | dropped; keep `PyGithub`, `rich`, `tenacity`, `python-dotenv` |

**Accounts:** OpenRouter and its keys disappear entirely. The only accounts
left are GitHub and Anthropic (`claude` login; headless runs are metered on
your Anthropic account or ride a subscription).

`.env` shrinks to: `GITHUB_TOKEN`, `GITHUB_REPO`, `MAX_PARALLEL`, `TMUX_VIEW`,
`SANDBOX_IMAGE`, `SANDBOX_CMD`, `SANDBOX_TIMEOUT`.

## 3. The new shape

Same pipeline, one engine:

```
you ── issue + agent:ready
        │
        ▼
  designer        claude -p  (READS THE REPO, writes DESIGN.md, opens PR)
        │
  ◆ gate 1        agent:needs-human — approve / iterate via PR comments
        │
  design review   claude -p ×2, fresh contexts, read-only tools,
        │         feasibility + security lenses, structured verdicts
        │
  coder           claude -p in worktree, Stop-hook loop until
        │         `make lint && make test` green   (§5)
        │
  re-check        docker run --network none  (unchanged)
        │         → impl PR → CI
  code review     claude -p ×2, fresh contexts, read-only tools —
        │         they run `git diff` and inspect the tree THEMSELVES
        │
  ◆ gate 3        agent:needs-human — you run it, merge
```

Every box is a **fresh `claude -p` process** — no resumed sessions, no shared
context. Independence between boxes comes from process + context isolation
plus tool allowlists, not from model families (§7 discusses that trade
honestly).

## 4. An agent per role

Every role is a native Claude Code agent definition — one file per role,
standard format, versioned with the repo:

```
.claude/
├── agents/
│   ├── designer.md                    # role agents (new)
│   ├── design-review-feasibility.md
│   ├── design-review-security.md
│   ├── code-review-correctness.md
│   ├── code-review-security.md
│   └── security-reviewer.md           # existing subagent — the coder delegates to it mid-run
├── skills/                            # unchanged — natively loaded by every role
└── settings.json                      # hooks: file protection (existing) + coder Stop gate (new)
```

Each file carries the whole role: frontmatter for wiring, body for the
system prompt —

```markdown
---
name: code-review-security
description: Reviews an implementation diff for injection, secret leakage, unsafe defaults
tools: Read, Glob, Grep, Bash(git diff *), Bash(git log *)
model: opus
---
You are CODE REVIEWER B (security). Inspect the diff yourself with git...
```

The orchestrator's `run_role()` parses the frontmatter and launches the role
as a **top-level fresh process**: body → `--append-system-prompt-file`,
`tools:` → `--allowedTools`, `model:` → `--model`, plus a per-role
wall-clock timeout. Because these are ordinary agent files, you also get them
interactively for free — "use the designer agent to sketch X" in a normal
Claude Code session runs the exact same definition.

**Why top-level processes, not one conductor session delegating to these as
subagents?** Two reasons, both load-bearing:

- **Control flow stays deterministic.** Labels + a dumb Python loop decide
  what runs next. A conductor session would put a model in charge of the
  state machine — the one job v1 was most right to keep AI out of.
- **Independence is physical, not promised.** Reviewer verdicts reach the
  memo and the issue verbatim from an isolated process. Subagent results are
  summarized back through their caller's context — a shared surface between
  implementer and verifier, which "nothing certifies its own work" forbids.

Subagents keep their place *inside* a role's run: the coder delegating a
pass to `security-reviewer`, the designer fanning out a codebase explorer to
keep its own context lean. Within-role delegation, yes; between-role
certification, never. Per-agent persistent memory (`memory: true`) stays
off for the same reason: Deliverator's agent memory is repo files — the
same pattern, but inspectable and versioned.

Per-role wiring (the successor of `STAGES`):

| Role | Tools (`--allowedTools`) | Model | Loop cap |
|---|---|---|---|
| designer | `Read,Glob,Grep,Write,Edit,Bash(git *),Bash(gh pr *)` | sonnet | `--max-turns 30` |
| design reviewers ×2 | `Read,Glob,Grep,Bash(git log *),Bash(git diff *)` | haiku / opus | `--max-turns 15` |
| coder | `Read,Glob,Grep,Edit,Write,Bash(make:*),Bash(pytest:*),Bash(ruff:*),Bash(git add:*),Bash(git commit:*)` | sonnet | `--max-turns 100` |
| code reviewers ×2 | `Read,Glob,Grep,Bash(git diff *),Bash(git log *)` | haiku / opus | `--max-turns 15` |

Immediate wins over v1:

- **The designer can finally read the code it designs against** — the biggest
  capability gap in v1 closes for free.
- **Reviewers verify instead of opining.** A code reviewer runs
  `git diff main...HEAD` itself, greps callers of changed functions, and
  checks acceptance criteria against real files. (Change 1's diff-bundling
  code gets deleted — the reviewer fetches its own context.)
- **Skills work everywhere.** `oauth-security-checklist` fires for the
  security reviewer by description matching, not by our keyword regexes.
- **Structured verdicts.** Reviewers run with
  `--json-schema '{"verdict": "APPROVE|REVISE", "findings": [...]}'` so the
  orchestrator parses a verdict field instead of scraping markdown.

## 5. Loop engineering (the part you asked about)

Current best practice for autonomous coding loops, and how v2 applies each:

**a. Fresh context per iteration ("Ralph loop").** State lives in files; every
iteration is a new process that re-reads reality. Deliverator already works
this way across *passes* — v2 makes it uniform across *all* roles. No
`--resume`, no `--continue` anywhere in the unattended path: resumed sessions
drift, forget instructions, and can't be re-run reproducibly.

**b. Verification-gated Stop hook (the coder's inner loop, hardened).** Today
we *ask* the coder to iterate until green and trust the transcript. v2 adds a
deterministic gate — a `Stop` hook in the worktree's settings that runs
`make lint && make test` and exits 2 (block) on failure, so the coder
*cannot end its turn* while the build is red; Claude Code force-releases
after 8 consecutive blocks so a hopeless task still terminates:

```json
{ "hooks": { "Stop": [ { "matcher": "*", "hooks": [
  { "type": "command", "command": ".claude/hooks/gate-green.sh" }
] } ] } }
```

The prompt states the goal; the hook enforces it; a wall-clock timeout bounds it.
Prompt, gate, cap — belt, braces, and a floor.

**c. Independent verification in a fresh context.** The strongest known
antidote to "the implementer grades its own homework" is a verifier that
shares nothing with the implementer. We already have the best version of
this: the network-less Docker re-check plus CI. Both stay, unchanged, as
deterministic layers *between* the agent layers.

**d. Explicit completion detection.** Every run ends with a machine-readable
result (`--output-format json` / the existing stream-json + sentinel-file
protocol for tmux windows). The orchestrator never infers "done" from prose.
The retry-context pattern from v1 stays: a failed Docker log is prepended to
the next coder run's input.

**e. Guardrails for unattended operation.** Per-role `--max-turns` (the new
runaway guard, replacing budget caps), strict per-role `--allowedTools`,
`--permission-mode acceptEdits` only for writers, worktree isolation, and the
existing PreToolUse file-protection hook (`.env`, migrations) which now
applies to *every* role, not just the coder.

**Explicitly deferred** (real, but not simpler): agent teams (experimental
multi-instance coordination with shared task lists — our orchestrator + labels
already does this job deterministically), per-agent persistent memory (§4),
and the Agent SDK as an orchestrator replacement. The SDK is the right move only if
the Python loop ever needs in-process hooks or streaming control; shelling to
`claude -p` keeps processes visible in tmux and the orchestrator dumb, which
is the point.

## 6. The orchestrator after

`loop.py` keeps: the STAGES table, label polling, `MAX_PARALLEL` pool,
worktrees, Docker re-check, tmux viewport, memos. It loses: everything that
knew what a model or a dollar was. The core becomes one generic runner:

```python
def run_role(role: str, issue_n: int, prompt: str, cwd) -> RoleResult:
    """Build `claude -p` from ROLE_SPECS[role] (tools, model, timeout,
    role file, json schema), run it in a tmux window (or captured),
    parse the final result object. ~40 lines, used by every stage."""
```

Stage handlers shrink to: gather inputs → `run_role(...)` → write memo →
comment → flip label. Estimated net: **-600 lines hand-rolled plumbing,
+150 lines runner/specs.** The orchestrator ends up ~400 lines with no AI
inside — closer to its own founding myth than v1 ever was.

`gh.py` (PyGithub + retries) stays for the *orchestrator's* GitHub verbs;
*agents* talk to GitHub through the `gh` CLI under allowlist, which they
already understand natively. (GitHub MCP server is the structured
alternative; `gh` is simpler and battle-tested headless — revisit only if
agents start fumbling CLI output.)

## 7. Honest trade-offs

- **Cross-family review dies.** v1's DeepSeek/Qwen reviewers existed so the
  coder's blind spots wouldn't bless themselves. v2 reviewers are all Claude.
  Mitigations, in order of value: (1) reviewers get *tools* — a reviewer that
  actually runs the diff and greps the codebase catches more than a blind
  cross-family one reading a prose bundle; (2) fresh contexts + different
  lenses + different models/tiers (haiku vs opus) + different effort levels;
  (3) the deterministic layers (Docker, CI) don't have model blind spots at
  all. If family diversity ever proves its absence painful, one reviewer slot
  can be filled by any other vendor's CLI later without re-architecting.
- **No spend dashboard.** Acceptable by declaration ("get rid of all the cost
  stuff"). Runaway protection moves from dollars to wall-clock timeouts. If you
  ever want a number, every JSON result still carries `total_cost_usd` — we
  just stop booking it.
- **Anthropic becomes a single point of failure.** One outage stops the loop
  (v1 could limp on OpenRouter). The loop parks safely on labels, so an
  outage costs time, not state.

## 8. Migration plan

Ordered so the system works after every step:

1. **Delete cost machinery** — `llm.py` ledger/locks/caps, `dashboard.py`,
   `provision_keys.py`, `check_models.py`, costs.csv, `MAX_USD` checks.
   (`llm.call()` temporarily loses booking, nothing else.)
2. **Add `run_role()` + `ROLE_SPECS`; port the two code reviewers** to
   fresh-context `claude -p` with read-only tools and JSON verdicts. Delete
   `build_review_bundle` and its tests (reviewer fetches its own diff).
3. **Port the design reviewers**, delete `skills.py` and `agents/roles.py`.
4. **Port the designer** (biggest behavior upgrade: repo-aware design).
   `llm.py` is now empty — delete it.
5. **Add the coder Stop-hook gate** (`gate-green.sh` + worktree settings).
6. **Delete `bot.py` and `oneshot`**, trim `.env.example`, `pyproject`.
7. **Rewrite README/OVERVIEW** sections 1, 3.4, 3.6–3.7 and the role/economics
   prose; update LABS.md invocation examples.

Each step is one commit, tests stay green throughout (the runner gets the
same pure-function + fake-`claude` test treatment the sentinel code has).

## 9. Open questions

1. **Where design iteration happens.** Today the designer opens a *design PR*
   (DESIGN.md alone on a branch); you comment on the PR to iterate, and
   approving the PR is the sign-off. The lighter alternative: no design PR —
   the design lands as an issue comment and you iterate in the issue thread.
   PR = inline comments + audit trail; issue thread = one less branch/PR per
   issue. **Proposal: keep the design PR** — it's the highest-leverage touch
   point, so the better commenting UX earns its overhead.
2. **Which Claude model each role runs** (the §4 table: designer/coder on
   sonnet, reviewers haiku + opus). With cost tracking gone this is purely a
   quality/speed choice. **Proposal: start with the table**, upgrade any role
   that visibly underperforms.
3. **Should reviewers auto-flip labels on double-APPROVE** at the design
   stage, or does every stage still land on `agent:needs-human`? (Proposal:
   keep the human gate everywhere; revisit after a month of v2.)
