---
date: 2026-07-05
kind: article
tags:
  - agentic-engineering
  - agents
  - claude-code
  - harness
  - loop-engineering
tldr: "Field guide compiled from the vault's agentic-engineering sources — harnesses, loops, 24/7 agents — plus a hands-on lab for building a multi-agent loop with Claude Code and GitHub."
---
Macnaught 60-foot
# Agentic Engineering: A Field Guide

*Compiled July 5, 2026 from 10 sources in this vault. Part 1 synthesizes everything the sources teach; Part 2 is a hands-on lab that builds the system step by step. Web version: https://claude.ai/code/artifact/6ad0466d-da51-4e82-b92e-d95d87998fbf*

---

# Part 1 — What the sources teach

## 1. The shift: from vibe coding to agentic engineering

Across all ten sources one story repeats. The leverage point in AI-assisted development has moved twice: first from writing code to writing prompts, and now from writing prompts to **designing the systems that do the prompting**. Karpathy calls the destination "agentic engineering"; Addy Osmani calls the practice "loop engineering"; LangChain and Anthropic call the machinery a "harness." They are describing the same object from three angles.

Karpathy's Sequoia talk frames why this is an engineering discipline. LLMs are "ghosts" — jagged statistical entities, brilliant at some tasks and inexplicably bad at neighboring ones — so the engineer's job is to find the edges of that jagged frontier and build systems that stay inside it. His practical thesis is the most useful sentence in the corpus:

> Verifiability is the bottleneck. If you can't cheaply verify output, the AI's utility collapses. — Karpathy

That's why he argues the most valuable work in 2026 is **building eval harnesses, not writing code** — and why human attention, not lines of code, is the scarce resource. Every architecture below is a machine for converting expensive human attention into cheap automated verification. His other line to keep in your pocket: *"You can outsource your thinking, but you can never outsource your understanding."*

## 2. The harness: everything that isn't the model

LangChain's "The Anatomy of an Agent Harness" gives the field its cleanest equation: **Agent = Model + Harness**. The harness is every piece of code, configuration, and execution logic that isn't the model — system prompts, tool/skill/MCP descriptions, bundled infrastructure (filesystem, sandbox, browser), orchestration logic, and hooks. The model contains the intelligence; the harness makes it *useful*. Models alone can't maintain state, execute code, reach post-cutoff knowledge, or configure environments — and the harness is a big lever on its own: LangChain improved their Terminal Bench placement **by changing the harness alone**.

The six components:

- **Filesystems** — durable storage across sessions, intermediate outputs, a multi-agent collaboration surface; git adds versioning and rollback.
- **Bash / code execution** — agents design their own tools on the fly ("give the model a computer").
- **Sandboxes** — isolate agent code, scale via on-demand environments, enable self-verification loops.
- **Memory & search** — memory file standards (AGENTS.md); web search and MCP for real-time knowledge.
- **Context management** — compaction, tool-output offloading, progressive-disclosure skills.
- **Long-horizon execution** — planning/decomposition, test-driven self-verification, the Ralph Loop for crossing context windows.

**Harness design under load** (Anthropic Labs, "Harness Design for Long-Running Application Development"): two failure modes emerge in multi-hour autonomous sessions. *Context anxiety* — models prematurely wrap up near perceived context limits; fixed by full **context resets with structured handoffs**, not compaction. *Self-evaluation bias* — agents praise their own work; fixed by a GAN-inspired split into **generator and evaluator agents** (plus a planner for full-stack), with "sprint contracts" fixing testable success criteria before implementation. When Opus 4.6 shipped, they **stripped the sprint scaffolding with no quality loss** — evaluators are valuable only at the boundary of model capability, and harness assumptions must be re-tested every model generation. As the awesome-list puts it: *the best harnesses are designed knowing those components will become unnecessary as models improve.*

> Subtle trap: Anthropic found the *wording* of grading criteria ("museum quality") unconsciously steered the generator's aesthetics, independent of evaluator feedback. Your rubrics are prompts too.

## 3. Enforcement: harness vs. environment vs. intent

Konishi's guide is the safety counterpart, built on a three-way separation:

| Layer | What it does | Mechanisms |
|---|---|---|
| **Intent** | *Advises.* Shapes what the agent tries. Cannot enforce. | CLAUDE.md, prompts |
| **Harness** | *Enforces in-process.* Shapes which tool calls dispatch. | settings.json rules (deny → ask → allow), hooks, MCP gates |
| **Environment** | *Enforces out-of-process.* Shapes what can actually happen. | OS users/ACLs, containers, network egress controls |

The misconception he demolishes: CLAUDE.md rules are *not* enforced — "text that becomes part of the model's context" with "no enforcement layer behind it." Anything that must be true lives in the harness or environment. Two missed mechanics: permissions **can't stop derived side effects** (shell tricks, byte-level egress, filesystem races, supply chain) — push those into hooks or OS boundaries; and in hooks **only exit code 2 blocks** — exit 0 just logs and proceeds.

Three graduated patterns with promotion criteria, not vibes:

- **A — Approval-first**: everything prompts. Start here.
- **B — Curated allow-list**: explicit allows, deny backstops. The daily driver. Promote from A when ~80% of prompts are predictable.
- **C — Sandboxed full-auto**: `bypassPermissions` — defensible *only* in a container with non-root user, network restrictions, no credential mounts. On a bare host: "reckless." Promote when a specific large task justifies the setup.

Even minimal JSONL hook logging pays for itself: post-incident analysis plus early warning of config drift.

## 4. Loop engineering: replacing yourself as the prompter

> Loop engineering is replacing yourself as the person who prompts the agent. You design the system that does it instead. — Addy Osmani

Instead of issuing task after task in a chat window, you build a recursive goal-oriented system that **discovers work, executes it, verifies results, and iterates**. Osmani's five components plus the one that makes them durable:

1. **Automations** — scheduled discovery/triage that finds work on its own.
2. **Worktrees** — isolated parallel lanes so concurrent agents never collide.
3. **Skills** — SKILL.md project knowledge, so you stop re-explaining context.
4. **Plugins/connectors** — MCP integrations into GitHub, Slack, Linear.
5. **Sub-agents** — separated ideation and verification so agents don't "grade their own homework." (Same conclusion Anthropic reached from the GAN direction, and the maker/checker split in the Python reference loop — three independent sources, one principle.)
6. **Persistent external memory** — markdown files, Linear boards — because models retain nothing between sessions.

Sabrina Ramonov's explainer compresses the loop to five beats — **wake → work → check → report → sleep** — and the discipline to a tagline: *"Stop prompting, start engineering loops."*

**The autonomy slider** (from the June hello-world notes):

| Level | What the loop does | Example |
|---|---|---|
| 0 — Copilot | Acts only when you type | Autocomplete |
| 1 — Suggested | Proposes, you approve each | Goal-mode stopping every step |
| 2 — Per-step review | Runs, pauses between phases | Maker–checker PR loop |
| 3 — Batch review | Runs fully, you review the result | Daily summary → Slack |
| 4 — Self-fork | Creates fix-PRs on drift, keeps going | Kanban workers with auto-claim |
| 5 — Meta-loop | Loops that modify other loops | Curator archiving idle skills |

**Where you set the slider is the whole game.** Start at 2; dial up only after the checker has proven itself. Konishi's A→B→C, the 24/7 article's "start small," and this slider are the same idea: autonomy is earned, not configured.

## 5. Anatomy of a working loop

The June reference implementation — design → code → review in ~200 lines of Python, no framework — is the cell from which bigger systems grow:

```
[DESIGNER] → spec (requirements + design + acceptance criteria)
[CODER]    → implements spec, tests included
[REVIEWER] → reviews against spec, with pytest + ruff output as evidence
             ├─ APPROVED → summary, exit
             └─ CHANGES  → routed back to coder/designer, loop
```

Three agents, three reasons: separation of concerns produces better output; **the reviewer must not be the coder**; specialization lets you swap models per role — *the separation is the win, not the model size*.

The production details matter more than the agent count:

- **Objective gates before subjective review** — the reviewer sees test/lint output, machine evidence, not just code. Acceptance criteria are machine-verifiable from the start.
- **A machine-verifiable finish line** — concrete conditions: server starts clean, endpoints return the right codes, tests green, linters clean.
- **Explicit stop rules** — "40 minutes or 10 iterations without crossing the finish line → STOP and write a progress report." Loops without stop rules are how you wake up to a $400 bill and a repo full of thrash.
- **Everything persisted** — each run in `runs/<timestamp>/` with spec, code, reviews, history: resumable, diffable, greppable. Memory between iterations is a markdown file the agent appends to and re-reads.
- **Per-call cost logging.**

Own the loop as plain code: when it goes sideways at 2am, it's code you can read and modify.

## 6. Running agents 24/7

Continuous operation is a phase change (HowDoIUseAI): Claude Code stops being an interactive tool and becomes an **autonomous development partner**. The operational shifts:

- **External triggers replace prompts** — GitHub webhooks feed an automation server; issues, PRs, CI failures, schedules become the work queue.
- **Safety becomes architecture** — sandboxed execution, permission controls, git-based backups, quality gates.
- **Context is managed, not hoped about** — summarization near token limits.
- **Multiple agents need coordination** — specialized roles, shared state.
- **Monitoring is not optional** — tracking, alerting, health checks.

Trust model: **start small, expand responsibilities as trust builds.** The Hermes VPS setup (Hostinger + OpenRouter + systemd + Telegram, skills the agent writes for itself) is a lived version of the same pattern.

## 7. What the loop never absorbs: your job

Osmani's three problems loops do *not* eliminate:

- **Verification stays yours** — the loop runs tests; only you decide the thing built is the thing needed.
- **Knowledge gaps widen without active review** — stop reading the code and you lose the ability to judge it, then to steer.
- **"Cognitive surrender"** — passively accepting outputs erodes the judgment the system depends on.

> Build the loop. But build it like someone who intends to stay the engineer, not just the person who presses go. — Osmani

Concretely: agents write, review, test, and summarize the PRs — **spec approval and merge authority are the two things you keep**.

## 8. The reading list

In suggested order — concepts, practice, safety, rabbit hole:

1. **The Anatomy of an Agent Harness** (LangChain) — the vocabulary and the map; read first. https://www.langchain.com/blog/the-anatomy-of-an-agent-harness
2. **Loop Engineering** (Addy Osmani) — the practice, named; honest about what loops don't fix. https://addyosmani.com/blog/loop-engineering/
3. **From Vibe Coding to Agentic Engineering** (Karpathy, Sequoia — video) — the why: jagged frontiers, verifiability, evals. https://www.youtube.com/watch?v=96jN2OCOfLs
4. **Harness Design for Long-Running Application Development** (Anthropic Labs) — harness design under load, and why they deleted half of it. https://www.anthropic.com/engineering/harness-design-long-running-apps
5. **Master AI Loop Engineering in 11 minutes** (Sabrina Ramonov — video) — fastest end-to-end picture; pairs with [[2026-06-29-loop-engineering-hello-world]] and [[2026-06-29-loop-engineering-design-code-review-python]]. https://www.youtube.com/watch?v=IeCa4bA0viA
6. **Running Claude Code 24/7** (HowDoIUseAI) — the always-on operational playbook. https://www.howdoiuseai.com/blog/2026-02-13-running-claude-code-24-7-gives-you-an-autonomous-c
7. **Claude Code Harness and Environment Engineering** (Hidekazu Konishi) — the safety deep-dive; read before turning any dial past 2. https://hidekazu-konishi.com/entry/claude_code_harness_and_environment_engineering_guide.html
8. **You're Using 10% of Claude Code** (Jimi Barkway — video) — 900 hours of workflow distilled. https://www.youtube.com/watch?v=8u50owlqNkE
9. **Hermes + OpenRouter 24/7 setup** (Jimi Barkway — video) — your own always-on stack, documented. https://www.youtube.com/watch?v=oWtOOJ-fwFc
10. **awesome-harness-engineering** (ai-boost) — the ~2.8k-star rabbit hole. https://github.com/ai-boost/awesome-harness-engineering

## 9. Blueprint: the agent studio

Design principles (each traceable to a source): makers never check their own work · objective gates before subjective review · the work queue lives outside the agents (GitHub Issues/Linear as shared memory) · enforcement lives in harness + environment, never prompts · every loop has a finish line and a stop rule · autonomy is a dial turned up slowly, and scaffolding gets deleted as models improve.

Architecture at a glance:

```
        GitHub Issues / Linear  ←— the single work queue (labels = state machine)
                 ▲
   Discovery loop (nightly, autonomy 3): scan CI/stale PRs/TODOs → file issues → digest
                 ▼
  PLANNER → spec on the issue (your 👍 gates it)
  CODER   → worktree, implements approved spec, draft PR, never merges
  REVIEWERS (code + design) → BLOCKER/SUGGESTION/NIT comments on PR
                 ▼
  Gates: tests · lint · typecheck · CI  →  evidence attached to PR
                 ▼
  YOU: read digest, approve specs, merge PRs, answer escalations
  MEMORY/SKILLS: per-role memory dirs + SKILL.md self-updates + weekly curator
```

A day in the life: 06:30 the discovery loop files what overnight CI turned up and posts a digest → over coffee you approve one spec, edit another's acceptance criteria, answer one escalation → during the day coders claim specs in worktrees, reviewers comment, loops iterate → in the evening you read two fully-gated PRs, merge one, and your steering comment on the other becomes tomorrow's first iteration.

Safety floor at any autonomy level: agents never merge, never push to main, never touch credentials; destructive patterns deny-listed *and* hook-blocked; branches + worktrees with git as undo; every tool call logged; every loop has a stop rule. If a rule matters, it lives in the harness or the environment — never only in a prompt.

Part 2 builds this, step by step.

---

# Part 2 — Hands-on lab: the loop on Claude Code + GitHub

*Goal: by the end you have a repo where labeling an issue `agent:ready` causes a planner to spec it, a coder to implement it in a worktree, and a reviewer to critique the PR — with you approving specs and merging. Time: ~2–3 hours spread over a week if you follow the graduation schedule. Everything runs at autonomy 2 first.*

## Lab 0 — Prerequisites (10 min)

```bash
# Claude Code + GitHub CLI, authenticated
npm install -g @anthropic-ai/claude-code
claude --version
gh auth login
gh auth status

# jq for the audit hook
brew install jq
```

Create the lab repo (or use a real one — the lab is non-destructive; agents only ever open draft PRs):

```bash
gh repo create agent-studio-lab --private --clone
cd agent-studio-lab
```

Seed it with something real enough to review — a tiny Python package:

```bash
mkdir -p src/studio tests
cat > src/studio/__init__.py <<'EOF'
def greet(name: str) -> str:
    return f"Hello, {name}!"
EOF
cat > tests/test_greet.py <<'EOF'
from studio import greet

def test_greet():
    assert greet("Jorge") == "Hello, Jorge!"
EOF
cat > pyproject.toml <<'EOF'
[project]
name = "studio"
version = "0.1.0"
requires-python = ">=3.11"

[tool.pytest.ini_options]
pythonpath = ["src"]
EOF
git add -A && git commit -m "seed: tiny package with one test" && git push
```

## Lab 1 — The work queue: labels + issue templates (10 min)

Labels are the state machine. Create them:

```bash
gh label create "agent:ready"       --color 0E8A16 --description "Spec approved — a coder may claim this"
gh label create "agent:planning"    --color FBCA04 --description "Planner is writing a spec"
gh label create "agent:in-progress" --color 1D76DB --description "Coder is implementing"
gh label create "agent:review"      --color 5319E7 --description "Draft PR open, under agent review"
gh label create "needs-human"       --color D93F0B --description "Escalation — Jorge must decide"
```

The flow you're building: you file an issue → planner specs it (`agent:planning`) → **you** apply `agent:ready` after reading the spec → coder claims it (`agent:in-progress`) → draft PR (`agent:review`) → **you** merge. The two human touchpoints are deliberate — they're the spec-approval and merge authority you keep.

## Lab 2 — Intent layer: CLAUDE.md (10 min)

Remember Konishi: this file *advises*, it never enforces. Write it anyway — it's how every agent learns the house rules:

```bash
cat > CLAUDE.md <<'EOF'
# agent-studio-lab

Small Python package. src/ layout, pytest, ruff.

## Commands
- Test: `python -m pytest -q`
- Lint: `ruff check src tests`

## House rules (advisory — enforcement is in settings + hooks)
- Work only on branches named `agent/<issue-number>-<slug>`. Never commit to main.
- PRs are always drafts. Never merge, never close issues.
- Every PR body must include: the issue number, what changed, test output pasted verbatim.
- If blocked or uncertain, add the `needs-human` label to the issue and STOP.
- Stop rule: if the finish line isn't crossed after 10 tool-heavy iterations, stop and
  write a progress comment on the issue.
EOF
git add CLAUDE.md && git commit -m "add CLAUDE.md house rules" && git push
```

## Lab 3 — The agents (25 min)

Each role is a file in `.claude/agents/`. Frontmatter sets name, description, and tool access; the body is the system prompt. Create four:

```bash
mkdir -p .claude/agents
```

**`.claude/agents/planner.md`** — turns an issue into a sprint contract:

```markdown
---
name: planner
description: Turns a GitHub issue into a one-page spec with machine-verifiable acceptance criteria. Never writes code.
tools: Bash(gh:*), Read, Grep, Glob
---

You are the planner. Input: a GitHub issue number.

1. `gh issue view <N>` — read the issue and all comments.
2. Read the relevant code (Read/Grep) to ground the spec in reality.
3. Post ONE comment on the issue containing a spec with exactly these sections:
   ## Requirements (functional + non-functional, specific — "returns 400 with
   {"error": ...} on malformed input", never "handles errors")
   ## Design (components, data flow, files to touch)
   ## Out of scope (explicit)
   ## Acceptance criteria (every item machine-verifiable: a command + expected result)
4. Swap the issue label: remove `agent:planning`, do NOT add `agent:ready` —
   that label is applied by a human after reading your spec.
5. Length target: one page. Prefer boring technology; default to stdlib.

You never write code. You never create branches or PRs.
```

**`.claude/agents/coder.md`** — implements an approved spec:

```markdown
---
name: coder
description: Implements an approved spec from a GitHub issue in the current worktree. Opens a draft PR. Never merges.
tools: Bash, Read, Edit, Write, Grep, Glob
---

You are the coder. Input: an issue number with an approved spec (label `agent:ready`).

1. `gh issue view <N>` — read the issue and the spec comment. The spec is your contract;
   if it's missing or ambiguous, label `needs-human` and STOP.
2. Relabel: remove `agent:ready`, add `agent:in-progress`.
3. You are already in a dedicated worktree on branch `agent/<N>-<slug>`. Verify with
   `git branch --show-current` — if it says `main`, STOP.
4. Implement the spec. Write tests for every acceptance criterion FIRST, then code
   until they pass.
5. Finish line — ALL true before opening the PR:
   - `python -m pytest -q` → all green
   - `ruff check src tests` → clean
   - every acceptance criterion demonstrably met
6. `gh pr create --draft` with: issue number, what changed, verbatim pytest + ruff
   output. Relabel issue: `agent:review`.
7. Stop rule: 10 failed iterations against the finish line → write a progress comment
   on the issue, label `needs-human`, STOP. Do not keep spinning.

Append one line per meaningful attempt to `memory/coder/journal.md`
(what you tried, what you learned). Read that file before starting.
```

**`.claude/agents/code-reviewer.md`** — the checker, never the maker:

```markdown
---
name: code-reviewer
description: Reviews a draft PR against its spec with test evidence. Comments BLOCKER/SUGGESTION/NIT. Never edits code.
tools: Bash(gh:*), Bash(python -m pytest:*), Bash(ruff:*), Read, Grep, Glob
---

You are the reviewer. You did not write this code. Input: a PR number.

1. `gh pr view <N>` and `gh pr diff <N>` — read the PR, its linked issue, and the spec.
2. Run the gates yourself — never trust pasted output:
   `gh pr checkout <N>`, then `python -m pytest -q` and `ruff check src tests`.
3. Judge four things, in order: spec fidelity (does it do what the acceptance
   criteria say — run them), correctness, security, test coverage.
4. Post ONE review via `gh pr review <N>` with every finding classified
   [BLOCKER] / [SUGGESTION] / [NIT]. Max 20 comments — curate.
5. Verdict rules: any failing gate is an automatic BLOCKER. Never approve unless
   every acceptance criterion passes when YOU run it. "Looks good" without
   evidence is forbidden.

Append recurring findings to `memory/reviewer/patterns.md` so future reviews
(and future CLAUDE.md updates) learn from them.
```

**`.claude/agents/triage.md`** — the discovery loop's brain:

```markdown
---
name: triage
description: Nightly discovery — scans repo health, files/triages issues, writes the morning digest. Read-only on code.
tools: Bash(gh:*), Read, Grep, Glob
---

You are triage. No code changes, ever.

1. Scan: `gh run list --limit 10` (CI failures), `gh pr list` (stale drafts >3 days),
   `gh issue list` (unlabeled issues), `grep -rn "TODO\|FIXME" src/`.
2. For each real problem found, file ONE issue with a clear title, evidence, and the
   label `agent:planning` — unless a matching open issue already exists (search first).
3. Write the digest as a comment on the pinned issue titled "Daily digest":
   what needs Jorge (specs awaiting approval, PRs ready to merge, needs-human items),
   then what the agents did, in 10 lines or fewer.
```

```bash
mkdir -p memory/coder memory/reviewer
git add .claude memory && git commit -m "add planner/coder/reviewer/triage agents" && git push
```

## Lab 4 — Enforcement: settings + hooks (20 min)

Pattern B permissions — allow the boring, deny the dangerous, ask about the rest. **`.claude/settings.json`**:

```json
{
  "permissions": {
    "allow": [
      "Bash(python -m pytest:*)",
      "Bash(ruff check:*)",
      "Bash(gh issue:*)",
      "Bash(gh pr:*)",
      "Bash(gh run list:*)",
      "Bash(gh label:*)",
      "Bash(git status:*)", "Bash(git diff:*)", "Bash(git log:*)",
      "Bash(git add:*)", "Bash(git commit:*)", "Bash(git checkout:*)",
      "Bash(git branch:*)", "Bash(git push origin agent/*)"
    ],
    "deny": [
      "Bash(git push origin main:*)",
      "Bash(git push --force:*)",
      "Bash(gh pr merge:*)",
      "Bash(rm -rf:*)",
      "Read(.env)", "Read(**/.env)", "Read(~/.ssh/**)", "Read(~/.aws/**)"
    ]
  },
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash",
        "hooks": [{ "type": "command", "command": ".claude/hooks/guard.sh" }]
      }
    ],
    "PostToolUse": [
      {
        "matcher": "*",
        "hooks": [{ "type": "command", "command": ".claude/hooks/audit.sh" }]
      }
    ]
  }
}
```

The hooks — remember Konishi's mechanic: **only exit 2 blocks**. **`.claude/hooks/guard.sh`**:

```bash
#!/bin/bash
# Blocks pushes to main and merges even if a permission rule missed a variant.
input=$(cat)
cmd=$(echo "$input" | jq -r '.tool_input.command // empty')
if echo "$cmd" | grep -qE 'git push[^|;]*\b(main|master)\b|gh pr merge|git push[^|;]*--force'; then
  echo "BLOCKED by guard.sh: $cmd" >&2
  exit 2          # exit 2 = block. exit 0 would merely log and proceed.
fi
exit 0
```

**`.claude/hooks/audit.sh`** — the JSONL trail that pays for itself at incident time:

```bash
#!/bin/bash
mkdir -p .agent-logs
cat | jq -c '{ts: now|todate, tool: .tool_name, input: .tool_input}' \
  >> .agent-logs/audit.jsonl
exit 0
```

```bash
chmod +x .claude/hooks/*.sh
echo ".agent-logs/" >> .gitignore
git add -A && git commit -m "pattern-B permissions + guard/audit hooks" && git push
```

Sanity-check the guard before trusting it: run `claude`, ask it to `git push origin main`, and confirm the hook blocks it.

## Lab 5 — First loop, by hand (autonomy 2) (20 min)

Run the whole cycle manually once — you'll automate only what you've watched work.

**1. File a real issue:**

```bash
gh issue create \
  --title "Add a slugify(text) function" \
  --label "agent:planning" \
  --body "Need studio.slugify: lowercase, spaces/punctuation to single hyphens,
strip accents, collapse repeats, trim hyphens. Pure stdlib."
```

**2. Planner specs it** (from the repo root):

```bash
claude -p "Use the planner agent to spec issue #1"
```

Read the spec it posted (`gh issue view 1 --comments`). This is your first steering moment: edit anything vague, then approve by applying the label yourself:

```bash
gh issue edit 1 --add-label "agent:ready"
```

**3. Coder implements it — in a worktree** (Osmani's lane discipline):

```bash
git worktree add ../lab-issue-1 -b agent/1-slugify
cd ../lab-issue-1
claude -p "Use the coder agent to implement issue #1"
```

Watch what it does. It should write tests first, iterate to green, open a draft PR, relabel the issue.

**4. Reviewer critiques it — a different session, back in the main checkout:**

```bash
cd ../agent-studio-lab
claude -p "Use the code-reviewer agent to review PR #2"
```

Read its review. If there are BLOCKERs, send the coder back around the loop:

```bash
cd ../lab-issue-1
claude -p "Use the coder agent: address the BLOCKER review comments on PR #2, re-run the gates, push"
```

**5. You merge.** Read the diff yourself (this is the anti-cognitive-surrender rep — don't skip it), then:

```bash
gh pr ready 2 && gh pr merge 2 --squash
git worktree remove ../lab-issue-1
```

You just ran the design → code → review loop from the Python reference implementation, with Claude Code as the runtime and GitHub as the memory.

## Lab 6 — Automate the reviewer (event trigger) (15 min)

The reviewer earned its automation in Lab 5. Wire it to PR-open events. **`.github/workflows/agent-review.yml`**:

```yaml
name: Agent review on PR
on:
  pull_request:
    types: [opened, ready_for_review]
jobs:
  review:
    if: github.actor != 'github-actions[bot]'
    runs-on: ubuntu-latest
    permissions:
      contents: read
      pull-requests: write
      issues: write
    steps:
      - uses: actions/checkout@v4
        with: { fetch-depth: 0 }
      - run: npm install -g @anthropic-ai/claude-code
      - run: pip install pytest ruff
      - name: Review
        env:
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        run: |
          claude -p "Use the code-reviewer agent to review PR ${{ github.event.pull_request.number }}" \
            --permission-mode acceptEdits
```

```bash
gh secret set ANTHROPIC_API_KEY
git add .github && git commit -m "auto-review PRs on open" && git push
```

Note the CI runner *is* Konishi's Pattern C environment — ephemeral container, scoped token, no credentials of yours mounted — which is why relaxed permissions are defensible there and not on your Mac.

## Lab 7 — Automate discovery (schedule trigger) (15 min)

Create the pinned digest issue once:

```bash
gh issue create --title "Daily digest" --body "Triage posts here." 
gh issue pin 4   # use the number it printed
```

**`.github/workflows/agent-triage.yml`**:

```yaml
name: Nightly triage
on:
  schedule:
    - cron: "30 13 * * *"   # 06:30 PT
  workflow_dispatch: {}      # manual runs while you tune it
jobs:
  triage:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      issues: write
      pull-requests: read
      actions: read
    steps:
      - uses: actions/checkout@v4
      - run: npm install -g @anthropic-ai/claude-code
      - name: Triage
        env:
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        run: claude -p "Use the triage agent. Digest issue is #4."
```

Run it now instead of waiting for tonight: `gh workflow run agent-triage.yml`. Tomorrow morning your digest reads like the "day in the life" from Part 1. (Prefer no YAML? Claude Code's scheduled cloud agents — `/schedule` — can host this loop instead.)

## Lab 8 — Automate the coder (label trigger) — the big dial-turn (15 min)

Only do this after several clean manual runs of Lab 5. This is the move from autonomy 2 to 3 for the coder. **`.github/workflows/agent-code.yml`**:

```yaml
name: Coder on agent:ready
on:
  issues:
    types: [labeled]
jobs:
  code:
    if: github.event.label.name == 'agent:ready'
    runs-on: ubuntu-latest
    permissions:
      contents: write
      issues: write
      pull-requests: write
    steps:
      - uses: actions/checkout@v4
        with: { fetch-depth: 0 }
      - run: npm install -g @anthropic-ai/claude-code
      - run: pip install pytest ruff
      - name: Implement
        env:
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        run: |
          git checkout -b "agent/${{ github.event.issue.number }}-auto"
          claude -p "Use the coder agent to implement issue ${{ github.event.issue.number }}" \
            --permission-mode acceptEdits
```

The full loop now runs itself: **you file an issue → planner specs → you label `agent:ready` → coder PRs → reviewer critiques → you merge.** Your two touchpoints survived every automation pass — by design.

## Lab 9 — Memory, self-improvement, and the curator (20 min)

The agents already journal (`memory/coder/journal.md`, `memory/reviewer/patterns.md`). Close the self-improvement loop with a weekly curator — Ramonov's level-5 meta-loop, run at level 3 (batch review):

```bash
cat > .claude/agents/curator.md <<'EOF'
---
name: curator
description: Weekly memory/skills gardener. Distills journals into CLAUDE.md candidates, prunes stale memory. Never touches src/.
tools: Read, Write, Edit, Grep, Glob, Bash(gh issue:*)
---

Weekly pass:
1. Read memory/*/  and .agent-logs/audit.jsonl (last 7 days).
2. Distill: recurring reviewer findings or coder lessons that should become house
   rules → propose them as a diff to CLAUDE.md in a comment on the "Daily digest"
   issue. NEVER edit CLAUDE.md directly — Jorge approves rule changes.
3. Prune: entries in memory/ older than 30 days that never repeated → move to
   memory/archive/. Report what you pruned.
4. Report token/cost anomalies you can see in the audit log (runaway loops).
EOF
```

Run it weekly (another scheduled workflow, or locally: `claude -p "Use the curator agent"`). Note the pattern: the curator *proposes* CLAUDE.md changes and a human applies them — even self-improvement keeps your two touchpoints.

## Lab 10 — Graduation checklist

Work through these gates in order; each one is "earned autonomy" from the sources:

- [ ] Guard hook verifiably blocks `git push origin main` (test it, don't assume it)
- [ ] Five manual Lab-5 loops completed; you disagreed with the reviewer at least once and tuned its prompt
- [ ] Reviewer automated (Lab 6) and its comments are ones you'd have made
- [ ] Digest running nightly; it's accurate enough that you actually read it
- [ ] Coder automated (Lab 8); PRs arrive as drafts with verbatim gate output
- [ ] Audit log reviewed once — you can answer "what did the agents do Tuesday?"
- [ ] Curator proposed a CLAUDE.md change you accepted
- [ ] After the next model upgrade: re-test which gates the model no longer fails, and delete that scaffolding (Anthropic's lesson)

When every box is checked you have the studio from Part 1, Section 9: agents that discover, spec, build, and review — with their own memory and self-improving playbooks — while you do exactly two things: approve specs and merge. Stay the engineer; let the loops press go.
