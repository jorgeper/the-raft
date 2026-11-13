```text
 ░▒▓ _ \ __| |   _ _|\ \   /__| _ \   \__ __|_ \ _ \ ▓▒░░▒
 ▒░  |  |_|  |     |  \ \ / _|    /  _ \  | (   |  / ░▓▒░
 ░▓ ___/___|____|___|  \_/ ___|_|_\_/  _\_|\___/_|_\ ▒░▒▓░

> *"The Deliverator belongs to an elite order, a hallowed subcategory."*
> — Neal Stephenson, Snow Crash

> **⚠️ Alpha — v0.1.** Deliverator is under active development. Expect rough
> edges, missing pieces, and breaking changes between commits.

## Get it

```bash
git clone https://github.com/jorgeper/deliverator.git
cd deliverator
```

That's the whole install. For now, **everything happens inside this one
repo**: the Deliverator scaffolding lives at the root, and the apps you build
with it live in their own folders alongside it (see
[section 3.2](#32-create-a-folder-for-your-app)).

**Deliverator** is a persistent, multi-agent development system you fully
control, built entirely on **Claude Code**: **GitHub issues in, reviewed pull
requests out**, running 24/7 on a VPS or your laptop, steerable from your
phone — with you making exactly three kinds of decisions and agents doing
everything else.

**New to Deliverator?** Read **[OVERVIEW.md](OVERVIEW.md)** first — an
article-length tour of how the whole thing works and why it's shaped the way
it is, diagrams included. Then come back here to install it.

## The pattern: one repo, apps in folders

This is the one thing to understand before anything else. You don't install
Deliverator somewhere central and point it at repos. **Deliverator and the
apps it builds share one repository — this one.** The orchestrator, skills,
conventions, and CI live at the root; each app you build gets its own folder
next to them; your issues in this repo are the work queue.

Concretely: clone this repo → create a folder for your app → configure → file
issues → the agents build the app inside that folder. Setup is section 3
below.

(While Deliverator is alpha this keeps life simple: one repo to develop
Deliverator in, test it in, and build with. A copy-into-your-own-repo flow can
come later, once things stabilize.)

Follow it end to end and you have:

- An **orchestrator** (a small Python daemon, no AI inside) that watches
  GitHub for labeled issues and moves each one through a state machine:
  *design → design review → human gate → code → code review → human gate → merge*.
- **Every role is a Claude Code agent** (`.claude/agents/*.md`) launched as a
  fresh-context run with its own tools and model: a **repo-aware designer**,
  two **design reviewers**, a **coder**, and two **code reviewers** that run
  the diff themselves instead of reading prose about it.
- The **coder iterates until green** inside a per-issue git worktree — it
  writes code and tests, runs lint+tests, reads failures, and fixes them; a
  **Stop-hook gate** re-runs the build when it tries to finish, so it cannot
  end on red.
- An **independent verifier**: every coder claim is re-checked in a
  network-less Docker container the coder can't influence, then by CI, then by
  two reviewers in fresh contexts, then by you.
- **Native skills** (on-demand expertise, progressive disclosure) and
  **hooks** (mechanical file protection + the Stop gate) — no hand-rolled
  loaders, no API keys beyond GitHub and your Claude login.

Once you're set up, go build something with it: **[LABS.md](LABS.md)** walks
you through building a real web app end-to-end, adding a feature, and fixing a
bug — the three developer journeys, hands-on.

---

## 1. How it works (the 5-minute version)

*(This is the compressed reference. For the full story — the reasoning and
the trust model — read [OVERVIEW.md](OVERVIEW.md).)*

```
you ── file a brief (issue + agent:ready)
         │
         ▼
   designer ── explores the repo, drafts DESIGN.md, opens a design PR
         │
   ◆ TOUCH POINT 1 (you) ── iterate via PR comments · approve to sign off
         │
   design reviewers ×2 ── feasibility + security critique · you arbitrate
         │
   coder ── fresh-context run in a worktree · test→fail→fix · Stop gate
         │                                      blocks finishing while red
   orchestrator ── independent re-check in a network-less Docker container
         │           green → opens the implementation PR → CI runs
   code reviewers ×2 ── run the diff themselves · correctness · security
         │
   ◆ TOUCH POINT 3 (you) ── run it for real · approve & merge · CI releases
```

Everything between touch points 1 and 3 is **touch point 2: you watch, you
don't type**.

Three properties define the design:

1. **State lives in GitHub, not in any process.** An issue's `agent:*` label
   *is* its state. Kill the orchestrator any time; nothing is lost. Steer from
   a terminal or the GitHub phone app — anything that can flip a label.
   Agents are stateless too: every run is a fresh context; memory is files
   (memos, DESIGN.md, issue comments), never a resumed session.
2. **You steer at exactly three points.** Shape the brief and design (highest
   leverage), stay hands-off through the middle, validate and merge at the end.
3. **Nothing certifies its own work.** Coder → Docker re-check → CI →
   reviewers in fresh isolated contexts → you. Layered, mutually distrustful
   verification is what makes autonomy safe.

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

### Roles and models

Each role is an agent file in `.claude/agents/<role>.md`: frontmatter carries
its tools and default model, the body is its system prompt. The orchestrator
launches each as a top-level fresh `claude -p` process — never as subagents
under a conductor, so control flow stays deterministic and reviewer verdicts
never pass through an implementer's context. Defaults: designer and coder on
`sonnet`; one reviewer of each pair on `haiku`, the other on `opus` (different
tiers, different lenses). Override any role in `.env` with
`MODEL_<ROLE>` (e.g. `MODEL_CODE_REVIEW_SECURITY=opus`). Upgrade only roles
that visibly fail. Reviewers return structured `{verdict, findings}` JSON, not
prose to scrape.

### Memory

Every run is a fresh context; all continuity is files you can inspect:

| Layer | Loads | Holds |
|---|---|---|
| `AGENTS.md` (+ `CLAUDE.md` shim) | always | durable conventions — keep it tiny |
| `.claude/agents/<role>.md` | per role run | the role: prompt, tools, model |
| `.claude/skills/*/SKILL.md` | on demand (native progressive disclosure) | procedural know-how |
| `orchestrator/memory/issue-N.md` | per issue | spec, reviews, decisions, error logs |

### Guardrails (enforced, not requested)

| Guardrail | Mechanism |
|---|---|
| Human gates | issues park at `agent:needs-human`; only a label-flip proceeds |
| Tool allowlists | per role, from agent frontmatter — the coder gets `make`/`pytest`/`git commit`, not `curl`, not `git push`; reviewers are read-only |
| Stop gate | `.claude/hooks/gate-green.sh` blocks the coder from ending its turn while `make lint`/`make test` are red |
| File-protection hook | `.claude/settings.json` blocks edits to `.env` and `migrations/` from a separate OS process |
| Sandbox | validation re-runs in `docker run --network none`, seeing only the worktree |
| Runaway guards | wall-clock timeouts per run (`ROLE_TIMEOUT`, `CODER_TIMEOUT`) |

---

## 2. Repo layout

```
.
├── README.md                    # you are here — setup & reference
├── OVERVIEW.md                  # read first: how Deliverator works, article-style
├── LABS.md                      # hands-on: build an app, add a feature, fix a bug
├── AGENTS.md                    # always-on conventions (edit for your stack)
├── CLAUDE.md                    # @AGENTS.md shim for Claude Code
├── bootstrap_labels.sh          # creates the agent:* label vocabulary
├── .github/workflows/ci.yml    # the outer loop (validate every PR, release on merge)
├── .claude/
│   ├── agents/                  # THE ROLES: designer, design-review-{feasibility,security},
│   │                            #   coder, code-review-{correctness,security} + security-reviewer subagent
│   ├── skills/                  # design-doc, flask-conventions, run-inner-loop,
│   │                            #   acceptance-criteria-audit, oauth-security-checklist
│   ├── hooks/gate-green.sh      # Stop gate: the coder can't finish on a red build
│   └── settings.json            # file-protection hook + Stop gate wiring
├── worktrees/                   # per-issue workbenches appear here (gitignored)
├── my-app/                      # your app — one folder per app you build (§3.2)
└── orchestrator/
    ├── loop.py                  # state machine + stage handlers
    ├── runner.py                # launches any role as a fresh claude -p run
    ├── gh.py                    # GitHub glue (issues, labels, PRs)
    ├── worktree.py              # per-issue git worktrees
    ├── tmuxview.py              # live tmux viewport for role runs
    ├── pyproject.toml
    └── .env.example             # copy to .env and fill in
```

---

## 3. Setup

Works two ways: **local** (your dev box — build it here first so you can watch
it work) and **VPS** (same code, 24/7 — section 3.6). Steps 3.1–3.5 are
required.

### 3.1 Tools & accounts

```bash
# macOS (Linux: use your package manager; Docker from docker.com either way)
brew install gh
brew install --cask docker-desktop        # or: brew install docker colima && colima start
npm install -g @anthropic-ai/claude-code

# all five should print a version:
python3 --version && git --version && gh --version && docker --version && claude --version
```

You need Python **3.11+** and just two accounts:

1. **GitHub** — `gh auth login` (browser flow).
2. **Anthropic** — run `claude` once and log in. That single login powers
   every role: designer, reviewers, and coder are all Claude Code runs.

### 3.2 Create a folder for your app

Remember the pattern: Deliverator and your app share this repo. Your app gets
its own folder at the root — one folder per app:

```bash
# from your clone of deliverator
mkdir my-app && echo "# my-app" > my-app/README.md
git add my-app && git commit -m "Add my-app" && git push
```

From here on, "the repo" means this one: your issues drive the loop, the
agents' worktrees appear under `worktrees/`, and the app the agents build
lands in its folder (e.g. `my-app/`). When you file a brief, say which app
folder it's for.

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
# fill in GITHUB_REPO (this repo, e.g. your-username/deliverator)
```

Models default to what each role's `.claude/agents/<role>.md` declares
(`sonnet` for designer/coder, `haiku`+`opus` for the reviewer pairs);
override any role in `.env` with a `MODEL_<ROLE>` line — see the commented
block in `.env.example`.

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

### 3.6 Optional: the VPS — going 24/7

Any ~€5/mo box with 2 GB RAM. Nothing in the code changes — that's the payoff
of state-in-GitHub:

```bash
ssh root@YOUR_VPS_IP
apt update && apt install -y python3.11-venv git gh docker.io tmux nodejs npm
npm install -g @anthropic-ai/claude-code
gh auth login && claude   # authenticate both, then exit claude

git clone https://github.com/your-username/deliverator
cd deliverator/orchestrator
python3 -m venv .venv && source .venv/bin/activate && pip install -e .

# the one gitignored secret file travels by hand:
scp your-dev-box:deliverator/orchestrator/.env .

tmux new -s loop 'source .venv/bin/activate && python loop.py'
# detach: Ctrl-b then d · reattach: tmux attach -t loop
```

Steer from the GitHub app on your phone (labels + comments are the whole
vocabulary). Close your laptop — the system no longer needs it.

---

## 4. Adapting it to your stack

Deliverator ships tuned for **Python/Flask** (what the labs build). The genericity
seam is deliberately small:

1. **The `make` contract.** The coder, skills, and CI all assume
   `make install`, `make lint`, `make test` exist at the repo root. Keep the
   targets; change what they run — typically a root `Makefile` that delegates
   into your app folder (`cd my-app && …`).
2. **The sandbox re-check** — set in `.env`, no code changes:
   ```
   SANDBOX_IMAGE=node:22-slim
   SANDBOX_CMD=npm ci --no-audit && npm run lint && npm test
   ```
3. **CI** — mirror the same commands in `.github/workflows/ci.yml`.
4. **The stack skill** — replace `.claude/skills/flask-conventions/` with your
   stack's conventions skill; skills fire natively by description matching, so
   there are no trigger keywords to maintain.
5. **`AGENTS.md`** — your stack, your commands, your do-not-touch list.

Roles, gates, labels, worktrees, the Stop gate — all stack-agnostic (the gate
runs whatever `make lint`/`make test` mean in your repo).

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

### Watching agents live

Every role run streams into a `deliverator` tmux session — designer,
reviewers, coder alike — one window per (issue, role). tmux is the viewport
only: labels stay the source of truth, and killing tmux never loses work.

```bash
tmux attach -t deliverator     # windows like issue-12-coder, issue-12-code-review-security
```

Windows stay open after a run finishes so you can scroll back; windows for
closed issues are cleaned up automatically. No tmux (or `TMUX_VIEW=0` in
`.env`)? Every run is still fully logged — follow it with:

```bash
tail -f orchestrator/logs/<role>-issue-<N>.jsonl
```

---

## 6. Now go build something

**[LABS.md](LABS.md)** — three hands-on labs on your newly installed system:

1. **Lab 1** — build a real web app (landing page + Google OAuth + persistent
   users) end-to-end, steering only at the three touch points.
2. **Lab 2** — add a feature, and catch the review traps (boundary tests,
   auth enforcement).
3. **Lab 3** — fix a bug through the `agent:trivial` fast path with a
   regression test.
