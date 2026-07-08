# Black Sun

A harness for building apps with a team of AI agents — a PRD writer, an architect, a
coder that hill-climbs inside a Ralph-style goal loop, and two code reviewers on
different models — orchestrated through a work-item state machine. You keep exactly two
powers, and they never get automated: **approving specs** and **merging code**.

The design is loop engineering, not prompt engineering: you don't prompt the agents,
you file work items. Agents discover their work by state, execute it, and the harness —
plain Python you can read — verifies every claim by running the gates itself. An agent
saying "done" moves nothing; a green gate does. (Background: the
[field guide](agentic-engineering-field-guide.md) and [research/](research/) this repo
was built from; the full contract is [spec.md](spec.md).)

Everything runs locally with Claude Code (and optionally Codex for the second
reviewer), tracks work in GitHub Issues or plain markdown files, and can run 24/7 on a
VPS ([deploy/vps.md](deploy/vps.md)).

## Architecture

```
        GitHub Issues / .work/*.md   <- the single work queue (labels = state machine)
                    |
              orchestrator (plain python, --watch)  ..  polls, claims, dispatches
                    |
   prd ---------> PRD comment          <- YOU approve (blacksun approve)
   architect ---> design spec comment  <- YOU approve (blacksun approve)
   coder -------> GoalLoop in a git worktree: plan.json -> build -> harness runs gates
                    |                    (fresh context per iteration, guardrails,
                    |                     circuit breaker, budgets — spec §6)
              draft PR
                    |
   reviewer-a (claude) + reviewer-b (codex) -> VERDICT lines, evidence required
                    |
        both APPROVE -> pr:human-review  <- YOU read the history and merge
```

## Run the demo (5 minutes, no API keys, no network)

The demo drives one work item through the entire pipeline — request → PRD → your
(scripted) approval → design → approval → the coder's GoalLoop → a rejected review →
the fix → dual approval → merge — with scripted agents standing in for the models.
The harness around them (state machine, orchestrator, gates, events) is entirely real.

**1. One-time setup**

```sh
git clone <this-repo> && cd black-sun
uv venv .venv && uv pip install --python .venv/bin/python -e . pytest pytest-cov ruff
source .venv/bin/activate   # so `python -m blacksun ...` resolves here
```

**2. Run it**

```sh
make demo     # every state transition printed, board rendered at the end
make verify   # optional: the 13-point acceptance checklist (spec §17)
```

**3. Keep the artifacts and poke around**

```sh
python -m blacksun.demo --keep
# prints:  kept sandbox: /tmp/blacksun-demo-XXXX (events: .../events.jsonl)
```

Inside that sandbox: `blacksun/.work/items/1.md` (the item as a readable thread),
`blacksun/.work/board.md` (the kanban), `blacksun/runs/` (every prompt and output
verbatim), and `blacksun/.agent-logs/events.jsonl` — the full observability stream,
including the agents' live-streamed output:

```sh
jq -r '[.ts, .kind, .item // "-", .agent // "-"] | @tsv' <sandbox>/blacksun/.agent-logs/events.jsonl
```

**4. Watch it in the terminal dashboard** ([big-board](big-board/README.md))

```sh
cd big-board
uv venv .venv && uv pip install --python .venv/bin/python \
  textual rich pyyaml pytest pytest-cov pytest-asyncio ruff
make demo     # replays a recorded full lifecycle in the TUI at 20x —
              # active agents, live output pane, event feed, board (key 2)
```

**5. Live mode** — the console watching a real orchestrator (two terminals):

```sh
cd big-board && make run     # terminal 1: the dashboard
cd black-sun   && make run     # terminal 2: blacksun run --watch
```

## Going live

1. `gh auth login` and `claude` (Claude Code CLI) authenticated; optionally `codex`.
2. `scripts/setup-github.sh you/your-app` — creates the state labels.
3. Edit `config/blacksun.yaml`: `tracker: {kind: github, repo: you/your-app}` and point
   `target_repo:` at your app checkout.
4. `python -m blacksun init` — validates config, generates the native Claude Code
   subagent files, checks runtimes.
5. File work and run the loop:

```sh
python -m blacksun new "Add user login" --body "Users need accounts"
python -m blacksun run --watch      # or --once per tick, or --dry-run to preview
python -m blacksun status           # the board + what needs YOU
python -m blacksun approve 1        # your gate: PRD, then design, then merge
```

## Runtimes: Claude Code, Codex, GitHub Copilot

Every agent names a runtime; runtimes are declared once and are freely mixable
per agent (that's how the two reviewers run on different models):

```yaml
runtimes:
  claude: {cmd: claude, extra_flags: ["--permission-mode", "acceptEdits"]}
  codex: {cmd: codex, extra_flags: []}
  copilot: {cmd: copilot, kind: copilot, extra_flags: ["--allow-all-tools"]}

agents:
  reviewer-b:
    runtime: copilot        # cross-model review without Codex
    prompt: prompts/reviewer.md
    skills: [code-review-rubric]
    handles: pr:agent-review
```

**GitHub Copilot setup:**

1. Install the Copilot CLI: `npm install -g @github/copilot` (needs an active
   GitHub Copilot subscription).
2. Authenticate once: run `copilot` interactively and use `/login` (it can also
   pick up a `GH_TOKEN`/`GITHUB_TOKEN` with the right scopes — see
   `copilot help` and the GitHub docs for current options).
3. Smoke-test headless mode, which is what the harness drives:
   `copilot -p "say ok" --allow-all-tools`.
4. Add the runtime block above and point any agent's `runtime:` at it, then
   rerun `python -m blacksun init` — it reports each runtime as `ok` or
   `MISSING CLI`.

What changes on a non-Claude runtime: skills can't be natively preloaded, so
the registry inlines the role prompt and every SKILL.md body into the prompt
(same knowledge, portable delivery — spec §3.3), and there are no native
subagent files. `--allow-all-tools` hands Copilot broad tool access inside the
worktree; tighten with `--deny-tool`/`--allow-tool` flags in `extra_flags` if
you want a narrower policy. The safety floor doesn't move: whatever the
runtime, agents can't merge, can't push to main, and every human gate stays
actor-enforced in the state machine.

## Choosing the coder's loop engine

The coder can be driven by either of two goal loops (`loop.engine`):

```yaml
coder:
  runtime: claude
  prompt: prompts/coder.md
  skills: [tdd-workflow, run-and-verify]
  handles: ready
  loop:
    engine: python            # default — the built-in GoalLoop
    max_iterations: 10
    max_minutes: 90
    gates: ["make test", "make lint"]   # optional for python, REQUIRED for goal
```

- **`engine: python`** (default) — the built-in Ralph-style GoalLoop: fresh
  context per iteration, plan.json, guardrails, thrash breakers, budgets, and
  the harness re-running every gate after every iteration. Works with ANY
  runtime — this is the only engine for Copilot or Codex coders. `loop.gates`
  (optional here) become standing harness gates merged into the plan's own.
- **`engine: goal`** — one invocation of Claude Code's **native /goal
  command**: the harness prefixes the statement in `prompts/goal-coder.md`
  with `/goal `, sends it through the claude runtime, and lets Claude Code's
  own goal loop iterate internally. Requires a claude runtime and a non-empty
  `loop.gates`, because harness-owned completion still holds: after the run
  returns, the orchestrator executes every gate itself in the worktree —
  all green → `pr:agent-review`; any red gate or `NEEDS_HUMAN:` →
  `needs-human`. The model's word moves nothing, whichever engine you pick.

Config fails loudly at load if `engine: goal` is combined with a Copilot/Codex
runtime, has no gates, or `prompts/goal-coder.md` is missing. Edit that file to
tune what the native loop is told; the harness appends the gate list and the
work-item context on every dispatch.

## Your two touchpoints

- `blacksun status` shows a "Needs you" list: PRDs and designs to approve, agent-approved
  PRs to merge, escalations to re-route. Everything else runs itself.
- Approval is meaningful only if you read the thing. The agents write, review, and
  test; deciding that the built thing is the *right* thing never delegates.

## The self-improving agent set

The config ships a second team, `evolving` — same five roles on copies of the
prompts under `prompts/evolving/`, plus an **improver** agent — behind
`active_set:` in `config/blacksun.yaml` (default stays `classic`; switching sets
and rerunning `blacksun init` is the whole migration). The loop, per
[self-improve-spec.md](self-improve-spec.md):

- The harness scores every run (`blacksun scorecard`) and parses `LESSON:` lines
  out of agent output into the role journals itself.
- Every `improve_every` done items, the orchestrator files an improvement work
  item; the improver reads scorecard + journals + run transcripts and proposes
  ONE prompt diff with the metric it should move (`EXPECT:` line).
- You approve (`blacksun approve`) or reject (`blacksun reject`) the diff — a third
  human gate, enforced in the state machine like the other two. Applies are
  single git commits touching only `prompts/evolving/` and the `prompt-audit`
  skill (a code-enforced allowlist), listed by `blacksun improvements`.
- A regression guard watches the named metric and files a git-generated revert
  proposal if it worsens >20% — through the same gate.

Try it offline: `python -m blacksun.demo --improve`. The classic prompts are
never touched by any of this. Verification: `scripts/verify-improve.sh` (12
checks) alongside the original `scripts/verify.sh`.

## Documentation: the Black Sun Book

**[docs/README.md](docs/README.md)** is the front door — a four-part book:
concepts (loop engineering, the discipline), architecture (six deep dives with
diagrams), the operating guide (install, daily workflow, configuration, going
live, troubleshooting), and six hands-on labs. Twenty minutes to oriented:
[concepts/01](docs/concepts/01-from-prompts-to-loops.md) →
[architecture/01](docs/architecture/01-system-overview.md) → `make demo`.

## Hands-on labs

1. [Build an app from zero](docs/labs/01-build-an-app.md)
2. [Add a feature](docs/labs/02-add-a-feature.md)
3. [Fix a bug](docs/labs/03-fix-a-bug.md)
4. [Watch the loop save itself](docs/labs/04-watch-the-loop-save-itself.md)
5. [Teach the team](docs/labs/05-teach-the-team.md)
6. [Extend the blacksun](docs/labs/06-extend-the-blacksun.md)

## Learn more

- [docs/architecture.md](docs/architecture.md) — the architecture summary, with
  signposts into the book's deep dives.
- [AGENTS.md](AGENTS.md) — the house rules every agent reads.
- [deploy/vps.md](deploy/vps.md) — running 24/7 on a VPS with systemd.
