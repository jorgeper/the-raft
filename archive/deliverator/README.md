# The Agentic Loop — a starter kit

A persistent, multi-agent development system you fully control: **GitHub issues
in, reviewed pull requests out**, running 24/7 on a VPS or your laptop,
steerable from your phone — with you making exactly three kinds of decisions
and agents doing everything else.

Clone this repo, follow the setup below, and you end up with:

- An **orchestrator** (a ~300-line Python daemon, no AI inside) that watches
  GitHub for labeled issues and moves each one through a state machine:
  *design → design review → human gate → code → code review → human gate → merge*.
- A **design agent** and two **cross-family design reviewers** (via OpenRouter).
- A **coder** that runs Claude Code headless inside a per-issue git worktree —
  it writes code and tests, runs lint+tests, reads failures, and fixes them
  until green.
- An **independent verifier**: every coder claim is re-checked in a
  network-less Docker container the coder can't influence, then by CI, then by
  two code reviewers from *different model families*, then by you.
- **Skills** (on-demand expertise), **hooks** (mechanical file protection),
  **per-role budget caps**, a **cost dashboard**, and a **Telegram bot** so you
  can file briefs and approve designs from your phone.

Once you're set up, go build something with it: **[LABS.md](LABS.md)** walks
you through building a real web app end-to-end, adding a feature, and fixing a
bug — the three developer journeys, hands-on.

---

## 1. How it works (the 5-minute version)

```
you ── file a brief (issue + agent:ready)
         │
         ▼
   design agent ── drafts DESIGN.md, opens a design PR
         │
   ◆ TOUCH POINT 1 (you) ── iterate via PR comments · approve to sign off
         │
   design reviewers ×2 ── feasibility + security critique · you arbitrate
         │
   coder ── Claude Code headless in a worktree · test→fail→fix until green
         │
   orchestrator ── independent re-check in a network-less Docker container
         │           green → opens the implementation PR → CI runs
   code reviewers ×2 ── correctness vs design · security (different families)
         │
   ◆ TOUCH POINT 3 (you) ── run it for real · approve & merge · CI releases
```

Everything between touch points 1 and 3 is **touch point 2: you watch, you
don't type**.

Three properties define the design:

1. **State lives in GitHub, not in any process.** An issue's `agent:*` label
   *is* its state. Kill the orchestrator any time; nothing is lost. Steer from
   a terminal, the GitHub phone app, or Telegram — anything that can flip a
   label.
2. **You steer at exactly three points.** Shape the brief and design (highest
   leverage), stay hands-off through the middle, validate and merge at the end.
3. **Nothing certifies its own work.** Coder → Docker re-check → CI →
   cross-family reviewers → you. Layered, mutually distrustful verification is
   what makes autonomy safe.

### The state machine

| Label | Meaning | Handler |
|---|---|---|
| `agent:ready` | queued for the loop | drafts DESIGN.md, opens design PR |
| `agent:design-draft` | you asked for a revision | redrafts with your comments folded in |
| `agent:needs-human` | **parked at a gate — your move** | nothing proceeds until you flip it |
| `agent:design-approved` | you approved the design PR | two design reviewers critique |
| `agent:coding` | cleared for implementation | coder + Docker re-check → impl PR |
| `agent:trivial` | skip design (small fixes) | straight to the coder |
| `agent:code-review` | impl PR open | two code reviewers critique |
| `agent:done` | merged | — |

One `agent:*` stage label per issue at a time; moving the label *is* the state
transition. The loop advances each issue **one state per pass** (a bug can't
spiral through the pipeline in seconds).

### Roles, models, and money

Each role = a system prompt + a model, routed through OpenRouter so reviewers
come from different families than the coder (shared blind spots bless each
other's mistakes — diversity is the cheap mitigation). Cheap-first routing:
budget models on frequent small jobs, spend on the coder, upgrade only roles
that visibly fail. Money is controlled in four independent layers: your account
balance, **per-role capped keys** (enforced server-side — no bug of yours can
overspend), the in-loop `MAX_USD_PER_RUN` cap, and the cost dashboard.

### Memory

Model calls are stateless; all continuity is files you can inspect:

| Layer | Loads | Holds |
|---|---|---|
| `AGENTS.md` (+ `CLAUDE.md` shim) | always | durable conventions — keep it tiny |
| `.claude/skills/*/SKILL.md` | on demand (progressive disclosure) | procedural know-how |
| `orchestrator/memory/issue-N.md` | per issue | spec, reviews, decisions, error logs |

### Guardrails (enforced, not requested)

| Guardrail | Mechanism |
|---|---|
| Human gates | issues park at `agent:needs-human`; only a label-flip proceeds |
| Tool allowlist | coder may run `make`/`pytest`/`git commit` — not `curl`, not `pip install`, not `git push` |
| Hooks | `.claude/settings.json` blocks edits to `.env`, `role_keys.json`, `migrations/` from a separate OS process |
| Sandbox | validation re-runs in `docker run --network none`, seeing only the worktree |
| Budget caps | per-role keys enforced by OpenRouter; `MAX_USD_PER_RUN` in the loop |
| Least privilege | reviewers are read-only; only the coder writes |

---

## 2. Repo layout

```
.
├── README.md                    # you are here
├── LABS.md                      # hands-on: build an app, add a feature, fix a bug
├── AGENTS.md                    # always-on conventions (edit for your stack)
├── CLAUDE.md                    # @AGENTS.md shim for Claude Code
├── bootstrap_labels.sh          # creates the agent:* label vocabulary
├── .github/workflows/ci.yml    # the outer loop (validate every PR, release on merge)
├── .claude/
│   ├── skills/                  # design-doc, flask-conventions, run-inner-loop,
│   │                            #   acceptance-criteria-audit, oauth-security-checklist
│   ├── agents/                  # security-reviewer subagent
│   └── settings.json            # file-protection hook
├── worktrees/                   # per-issue workbenches appear here (gitignored)
└── orchestrator/
    ├── loop.py                  # state machine + stage handlers + coder
    ├── llm.py                   # model chokepoint: routing, keys, cost
    ├── agents/roles.py          # role = prompt + model (edit slugs here)
    ├── gh.py                    # GitHub glue (issues, labels, PRs)
    ├── worktree.py              # per-issue git worktrees
    ├── skills.py                # skill loader for completion-call roles
    ├── bot.py                   # Telegram front-end (optional)
    ├── check_models.py          # print live OpenRouter slugs + prices
    ├── provision_keys.py        # one budget-capped key per role (optional)
    ├── dashboard.py             # costs.csv → static costs.html
    ├── pyproject.toml
    └── .env.example             # copy to .env and fill in
```

---

## 3. Setup

Works two ways: **local** (your dev box — build it here first so you can watch
it work) and **VPS** (same code, 24/7 — section 8). Steps 3.1–3.5 are required;
6–8 are optional upgrades.

### 3.1 Tools & accounts

```bash
# macOS (Linux: use your package manager; Docker from docker.com either way)
brew install gh
brew install --cask docker-desktop        # or: brew install docker colima && colima start
npm install -g @anthropic-ai/claude-code

# all five should print a version:
python3 --version && git --version && gh --version && docker --version && claude --version
```

You need Python **3.11+** and three accounts:

1. **GitHub** — `gh auth login` (browser flow).
2. **Anthropic** — run `claude` once and log in. Interactive sessions ride your
   subscription; headless coder runs are API-metered.
3. **OpenRouter** — create an account at openrouter.ai, preload $5–10, create
   an API key (`sk-or-v1-…`). One gateway serves every model family, which is
   what makes cheap-first routing and cross-family reviewers possible.

### 3.2 Create your project repo from this starter

```bash
# new repo on GitHub, seeded with this scaffolding
gh repo create my-project --private --clone
cd my-project
# copy everything except .git from your clone of this starter:
rsync -a --exclude .git /path/to/this-starter/ .
git add -A && git commit -m "Agentic loop scaffolding" && git push
```

Then **edit `AGENTS.md`** for your stack (it ships with the Flask defaults the
labs use — fine to leave as-is if you're doing the labs first).

### 3.3 Labels — the state machine

```bash
./bootstrap_labels.sh
```

### 3.4 The orchestrator

```bash
cd orchestrator
python3 -m venv .venv && source .venv/bin/activate
pip install -e .

cp .env.example .env
gh auth token          # prints a token — paste into GITHUB_TOKEN in .env
# fill in OPENROUTER_API_KEY and GITHUB_REPO (your-username/my-project)
```

Check live model slugs and update `agents/roles.py` if needed (**model IDs
drift** — the philosophy is durable, the slugs are not):

```bash
python check_models.py
```

### 3.5 First light

```bash
python loop.py
```

In another terminal, file a smoke-test issue and watch the loop move it:

```bash
gh issue create --title "Spike: confirm the loop works" \
  --body "Just checking the pipeline advances through states." \
  --label "agent:ready"
```

Within a pass or two: a design PR appears, the issue gets a 📐 comment, and it
parks at `agent:needs-human`. **The state machine lives.** Close the spike
issue and delete its branch when done.

> **Note on CI:** until your repo has real application code, CI fails on fresh
> PRs (there's nothing to install). Expected — the gate exists before the thing
> it gates.

### 3.6 Optional: per-role budget caps + cost dashboard

Create a **Management API key** at openrouter.ai/settings/management-keys, add
it to `.env` as `OPENROUTER_MANAGEMENT_KEY`, then:

```bash
python provision_keys.py     # writes role_keys.json (gitignored)
```

`llm.py` picks it up automatically on the next start — every role switches to
its own server-side-capped key, no code changes. For visibility:

```bash
python dashboard.py && open costs.html    # spend by role and by day
```

A realistic solo loop lands in low single-digit dollars per day; the caps exist
for the bad day (the runaway retry), not the normal one.

### 3.7 Optional: Telegram — the phone in the loop

File briefs, get pinged at your gates, approve a design with a tap. Design
approval is one tap, but **code merge requires opening the PR** — you never
rubber-stamp a merge from a bus.

1. In Telegram, chat with **@BotFather** → `/newbot` → copy the token into
   `.env` as `TELEGRAM_BOT_TOKEN`.
2. Send any message to your new bot, then get your chat ID and put it in
   `TELEGRAM_CHAT_ID` (the bot ignores every other chat):

```bash
python3 - <<'PY'
import os, httpx
from dotenv import load_dotenv; load_dotenv()
tok = os.environ["TELEGRAM_BOT_TOKEN"]
r = httpx.get(f"https://api.telegram.org/bot{tok}/getUpdates", timeout=30).json()
for u in r.get("result", []):
    m = u.get("message") or u.get("edited_message") or {}
    if "chat" in m: print("Your chat id is:", m["chat"]["id"])
PY
```

3. Restart `loop.py`. Commands: `/new <brief>`, `/say <issue#> <msg>`,
   `/status`, `/spend`. The bot uses long polling — no public URL, no open
   ports; it works behind a router and on a VPS unchanged.

### 3.8 Optional: the VPS — going 24/7

Any ~€5/mo box with 2 GB RAM. Nothing in the code changes — that's the payoff
of state-in-GitHub:

```bash
ssh root@YOUR_VPS_IP
apt update && apt install -y python3.11-venv git gh docker.io tmux nodejs npm
npm install -g @anthropic-ai/claude-code
gh auth login && claude   # authenticate both, then exit claude

git clone https://github.com/your-username/my-project
cd my-project/orchestrator
python3 -m venv .venv && source .venv/bin/activate && pip install -e .

# the two gitignored secret files travel by hand:
scp your-dev-box:my-project/orchestrator/.env .
scp your-dev-box:my-project/orchestrator/role_keys.json .   # if provisioned

tmux new -s loop 'source .venv/bin/activate && python loop.py'
# detach: Ctrl-b then d · reattach: tmux attach -t loop
```

Message your bot `/status` from your phone. It answers from the VPS. Close your
laptop — the system no longer needs it.

---

## 4. Adapting it to your stack

The kit ships tuned for **Python/Flask** (what the labs build). The genericity
seam is deliberately small:

1. **The `make` contract.** The coder, skills, and CI all assume
   `make install`, `make lint`, `make test` exist in your project. Keep the
   targets; change what they run.
2. **The sandbox re-check** — set in `.env`, no code changes:
   ```
   SANDBOX_IMAGE=node:22-slim
   SANDBOX_CMD=npm ci --no-audit && npm run lint && npm test
   ```
3. **CI** — mirror the same commands in `.github/workflows/ci.yml`.
4. **The stack skill** — replace `.claude/skills/flask-conventions/` with your
   stack's conventions skill, and update the coder's trigger keywords in
   `orchestrator/skills.py`.
5. **`AGENTS.md`** — your stack, your commands, your do-not-touch list.

Roles, gates, labels, budgets, the bot, worktrees — all stack-agnostic.

Two coder modes (set `CODER_MODE` in `.env`):

- **`headless`** (default) — Claude Code runs the coder stage inside the
  worktree with a strict tool allowlist. It iterates: run tests → read
  failure → fix → repeat. This is why the system produces working code.
- **`oneshot`** — a single OpenRouter completion emits files as fenced blocks;
  no harness dependency, any model. One blind attempt per pass. Kept as a
  fallback and as a demonstration of exactly what a harness buys.

---

## 5. Driving it day to day

Your entire steering vocabulary is comments + label flips:

```bash
# file work
gh issue create --title "..." --body "..." --label agent:ready     # design-first
gh issue create --title "..." --body "..." --label agent:trivial   # skip design

# touch point 1 — iterate on the design PR
gh pr comment <PR> --body "Key users on sub, not email. Revise."
gh issue edit <N> --add-label agent:design-draft --remove-label agent:needs-human

# sign off the design
gh pr review <PR> --approve
gh issue edit <N> --add-label agent:design-approved --remove-label agent:needs-human

# arbitrate the design reviews
gh issue edit <N> --add-label agent:coding --remove-label agent:needs-human

# touch point 3 — validate & ship
gh pr checkout <PR> && make install && make test && make lint   # then run it for real
gh pr merge <PR> --squash --delete-branch
gh issue edit <N> --add-label agent:done --remove-label agent:needs-human

# bounce a bad PR back (never fix it yourself — steer)
gh issue comment <N> --body "Repro: <precise failure>"
gh issue edit <N> --add-label agent:coding --remove-label agent:needs-human
```

When a role keeps underperforming: sharpen its skill, then its prompt, then its
model — in that order of cost. **Correct the system, not the code.** And when
in doubt, add a verifier, not autonomy.

---

## 6. Now go build something

**[LABS.md](LABS.md)** — three hands-on labs on your newly installed system:

1. **Lab 1** — build a real web app (landing page + Google OAuth + persistent
   users) end-to-end, steering only at the three touch points.
2. **Lab 2** — add a feature, and catch the review traps (boundary tests,
   auth enforcement).
3. **Lab 3** — fix a bug through the `agent:trivial` fast path with a
   regression test.
